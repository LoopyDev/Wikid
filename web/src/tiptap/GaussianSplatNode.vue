<script setup>
import { NodeViewWrapper } from '@tiptap/vue-3';
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { SplatMesh } from '@sparkjsdev/spark';
import { GIFEncoder, quantize, applyPalette } from 'gifenc';
import { api } from '../api/client';
import { useWorkspaceStore } from '../stores/workspace';

const props = defineProps({
  editor: { type: Object, required: true },
  node: { type: Object, required: true },
  updateAttributes: { type: Function, required: true },
  selected: { type: Boolean, default: false },
});

const workspace = useWorkspaceStore();
const isEditable = computed(() => props.editor?.isEditable ?? true);
const src = computed(() => props.node?.attrs?.src || '');
const containerRef = ref(null);
const loading = ref(false);
const error = ref('');

let renderer = null;
let scene = null;
let camera = null;
let controls = null;
let splatMesh = null;
let animationId = null;
let resizeObserver = null;

function frameSplat() {
  if (!splatMesh) return;
  let box;
  try {
    box = splatMesh.getBoundingBox(true);
  } catch {
    return;
  }
  if (!box || box.isEmpty()) return;

  // Splat content is usually offset (high in Y); shift the mesh so its center
  // sits at the origin, which is where the camera/controls already look.
  const center = box.getCenter(new THREE.Vector3());
  splatMesh.position.sub(center);
}

function generatePreviewGif() {
  if (!renderer || !scene || !camera || !splatMesh) return;

  const gifWidth = 320;
  const gifHeight = 180;
  const frames = 36;
  const delay = 80; // ms per frame

  // Use a separate small renderer for GIF capture
  const gifRenderer = new THREE.WebGLRenderer({ antialias: false, preserveDrawingBuffer: true });
  gifRenderer.setSize(gifWidth, gifHeight);
  const gifCamera = camera.clone();
  gifCamera.aspect = gifWidth / gifHeight;
  gifCamera.updateProjectionMatrix();

  // Get the orbit center (controls target) and radius
  const target = controls.target.clone();
  const offset = camera.position.clone().sub(target);
  const radius = offset.length();
  const baseY = camera.position.y;

  const gif = GIFEncoder();

  for (let i = 0; i < frames; i++) {
    const angle = (i / frames) * Math.PI * 2;
    gifCamera.position.set(
      target.x + radius * Math.cos(angle),
      baseY,
      target.z + radius * Math.sin(angle),
    );
    gifCamera.lookAt(target);

    gifRenderer.render(scene, gifCamera);

    const gl = gifRenderer.getContext();
    const pixels = new Uint8Array(gifWidth * gifHeight * 4);
    gl.readPixels(0, 0, gifWidth, gifHeight, gl.RGBA, gl.UNSIGNED_BYTE, pixels);

    // WebGL reads bottom-up, flip vertically
    const flipped = new Uint8Array(gifWidth * gifHeight * 4);
    for (let y = 0; y < gifHeight; y++) {
      const srcRow = (gifHeight - 1 - y) * gifWidth * 4;
      const dstRow = y * gifWidth * 4;
      flipped.set(pixels.subarray(srcRow, srcRow + gifWidth * 4), dstRow);
    }

    const palette = quantize(flipped, 256);
    const indexed = applyPalette(flipped, palette);
    gif.writeFrame(indexed, gifWidth, gifHeight, { palette, delay });
  }

  gif.finish();
  gifRenderer.dispose();

  const blob = new Blob([gif.bytes()], { type: 'image/gif' });
  const reader = new FileReader();
  reader.onload = () => {
    props.updateAttributes({ preview: reader.result });
  };
  reader.readAsDataURL(blob);
}

let loadSeq = 0;

async function initScene() {
  const el = containerRef.value;
  if (!el || !src.value) return;

  cleanup();
  const seq = ++loadSeq;
  const url = src.value;
  let source = { url };
  if (api.isApiUrl(url)) {
    // API uploads need the session cookie, which Spark's own fetch doesn't send
    loading.value = true;
    try {
      const bytes = await api.fetchUpload(url);
      source = { fileBytes: new Uint8Array(bytes), fileName: url.split('?')[0].split('/').pop() };
    } catch (err) {
      console.warn('Failed to load splat', err);
      loading.value = false;
      return;
    }
    if (seq !== loadSeq) return;
  }

  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(60, el.clientWidth / el.clientHeight, 0.1, 1000);
  camera.position.set(0, 1, 3);

  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(el.clientWidth, el.clientHeight);
  el.appendChild(renderer.domElement);

  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.1;

  splatMesh = new SplatMesh({
    ...source,
    onLoad: () => {
      loading.value = false;
      // Frame the camera on the splat's center so it isn't off-screen
      frameSplat();
      // Generate preview GIF if we don't have one yet
      if (!props.node?.attrs?.preview) {
        // Wait a few frames for the splat to fully render before capturing
        setTimeout(generatePreviewGif, 500);
      }
    },
  });
  loading.value = true;
  scene.add(splatMesh);

  resizeObserver = new ResizeObserver(() => {
    if (!renderer || !camera || !el) return;
    const w = el.clientWidth;
    const h = el.clientHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
  });
  resizeObserver.observe(el);

  function animate() {
    animationId = requestAnimationFrame(animate);
    controls.update();
    renderer.render(scene, camera);
  }
  animate();
}

function cleanup() {
  loadSeq++;
  if (animationId != null) {
    cancelAnimationFrame(animationId);
    animationId = null;
  }
  if (resizeObserver) {
    resizeObserver.disconnect();
    resizeObserver = null;
  }
  if (controls) {
    controls.dispose();
    controls = null;
  }
  if (splatMesh) {
    splatMesh.dispose();
    splatMesh = null;
  }
  if (renderer) {
    renderer.dispose();
    if (renderer.domElement?.parentElement) {
      renderer.domElement.parentElement.removeChild(renderer.domElement);
    }
    renderer = null;
  }
  scene = null;
  camera = null;
}

async function handleFileUpload(e) {
  const file = e.target?.files?.[0];
  if (!file) return;
  if (!file.name.toLowerCase().endsWith('.spz')) {
    error.value = 'Only .spz files are supported';
    return;
  }
  error.value = '';
  loading.value = true;
  try {
    const pageId = workspace.activePageId;
    const user = workspace.activeUser;
    const result = await api.uploadImage(file, {
      pageId,
      userId: user?.id,
      userName: user?.name,
    });
    if (result?.file?.url) {
      props.updateAttributes({ src: result.file.url, preview: '' });
    }
  } catch (err) {
    error.value = err?.message || 'Upload failed';
    loading.value = false;
  }
}

function handleDrop(e) {
  e.preventDefault();
  const file = e.dataTransfer?.files?.[0];
  if (!file) return;
  handleFileUpload({ target: { files: [file] } });
}

function handleDragOver(e) {
  e.preventDefault();
}

// Start once both the file (src) and the viewer container exist. This covers the
// first render, a fresh upload (Tiptap can set src before the container is attached)
// and src changing from a collaborator's edit.
watch([src, containerRef], ([val, el], [prevVal, prevEl]) => {
  if (val && el && (val !== prevVal || el !== prevEl)) initScene();
});

onBeforeUnmount(() => {
  cleanup();
});
</script>

<template>
  <NodeViewWrapper class="gs-node" :class="{ 'gs-node--selected': selected }" data-type="gaussianSplat">
    <!-- Viewer -->
    <div v-if="src" ref="containerRef" class="gs-viewer">
      <div v-if="loading" class="gs-overlay">Loading splat...</div>
    </div>

    <!-- Upload prompt -->
    <div
      v-else
      class="gs-upload"
      @drop="handleDrop"
      @dragover="handleDragOver"
    >
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
        <circle cx="12" cy="12" r="3" />
        <circle cx="12" cy="12" r="7" opacity="0.4" />
        <circle cx="12" cy="12" r="10" opacity="0.2" />
      </svg>
      <span v-if="isEditable">Drop an .spz file or click to upload</span>
      <span v-else>No splat file</span>
      <input
        v-if="isEditable"
        type="file"
        accept=".spz"
        class="gs-upload__input"
        @change="handleFileUpload"
      />
      <div v-if="error" class="gs-upload__error">{{ error }}</div>
      <div v-if="loading" class="gs-upload__loading">Uploading...</div>
    </div>
  </NodeViewWrapper>
</template>

<style scoped>
.gs-node {
  margin: 1rem 0;
  border-radius: 8px;
  overflow: hidden;
  border: 2px solid transparent;
  transition: border-color 0.15s;
}
.gs-node--selected {
  border-color: var(--color-accent, #3b82f6);
}
.gs-viewer {
  position: relative;
  width: 100%;
  height: 450px;
  background: #111;
  border-radius: 6px;
  overflow: hidden;
}
.gs-viewer canvas {
  display: block;
  width: 100% !important;
  height: 100% !important;
}
.gs-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.6);
  color: #aaa;
  font-size: 0.875rem;
  pointer-events: none;
}
.gs-upload {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 2.5rem;
  border: 2px dashed var(--color-border, #333);
  border-radius: 8px;
  color: var(--color-text-secondary, #888);
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s;
}
.gs-upload:hover {
  border-color: var(--color-accent, #3b82f6);
  background: rgba(59, 130, 246, 0.05);
}
.gs-upload__input {
  position: absolute;
  inset: 0;
  opacity: 0;
  cursor: pointer;
}
.gs-upload__error {
  color: #ef4444;
  font-size: 0.8rem;
}
.gs-upload__loading {
  color: var(--color-accent, #3b82f6);
  font-size: 0.8rem;
}
</style>
