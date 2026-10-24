import { Schema } from 'prosemirror-model';

const blockAttrs = {
  id: { default: null },
  syncedFrom: { default: null },
};

const tableCellAttrs = {
  colspan: { default: 1 },
  rowspan: { default: 1 },
  colwidth: { default: null },
};

export const collabSchema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    text: { group: 'inline' },
    paragraph: {
      group: 'block',
      content: 'inline*',
      attrs: { indent: { default: 0 }, ...blockAttrs },
    },
    heading: {
      group: 'block',
      content: 'inline*',
      attrs: { level: { default: 1 }, indent: { default: 0 }, ...blockAttrs },
    },
    toggleHeading: {
      group: 'block',
      content: 'heading block*',
      defining: true,
      isolating: true,
      attrs: { collapsed: { default: false }, ...blockAttrs },
    },
    blockquote: {
      group: 'block',
      content: 'block+',
      attrs: { ...blockAttrs },
    },
    bulletList: {
      group: 'block',
      content: 'listItem+',
      attrs: { ...blockAttrs },
    },
    orderedList: {
      group: 'block',
      content: 'listItem+',
      attrs: { order: { default: 1 }, ...blockAttrs },
    },
    listItem: {
      content: 'paragraph block*',
      attrs: { ...blockAttrs },
    },
    taskList: {
      group: 'block',
      content: 'taskItem+',
      attrs: { ...blockAttrs },
    },
    taskItem: {
      content: 'paragraph block*',
      attrs: { checked: { default: false }, ...blockAttrs },
      defining: true,
    },
    codeBlock: {
      group: 'block',
      content: 'text*',
      marks: '',
      attrs: { language: { default: null }, ...blockAttrs },
    },
    horizontalRule: {
      group: 'block',
      atom: true,
      attrs: {
        size: { default: 'medium' },
        align: { default: 'middle' },
        color: { default: null },
        ...blockAttrs,
      },
    },
    hardBreak: {
      inline: true,
      group: 'inline',
      selectable: false,
    },
    image: {
      group: 'block',
      inline: false,
      atom: true,
      attrs: {
        src: { default: null },
        alt: { default: null },
        title: { default: null },
        width: { default: null },
        ...blockAttrs,
      },
    },
    pageLink: {
      group: 'block',
      atom: true,
      attrs: {
        pageId: { default: '' },
        title: { default: '' },
        icon: { default: '' },
        subpageCount: { default: null },
        style: { default: 'card' },
        ...blockAttrs,
      },
    },
    databaseView: {
      group: 'block',
      atom: true,
      attrs: {
        pageId: { default: '' },
        title: { default: '' },
        icon: { default: '' },
        view: { default: null },
        ...blockAttrs,
      },
    },
    databaseForm: {
      group: 'block',
      atom: true,
      attrs: {
        formId: { default: '' },
        name: { default: '' },
        databasePageId: { default: '' },
        ...blockAttrs,
      },
    },
    tableOfContents: {
      group: 'block',
      atom: true,
      attrs: {
        ...blockAttrs,
      },
    },
    callout: {
      group: 'block',
      content: 'block+',
      defining: true,
      isolating: true,
      attrs: {
        icon: { default: '' },
        tone: { default: '' },
        ...blockAttrs,
      },
    },
    columns: {
      group: 'block',
      content: 'column+',
      isolating: true,
    },
    column: {
      content: 'block+',
      isolating: true,
      attrs: {
        width: { default: null },
      },
    },
    drawio: {
      group: 'block',
      atom: true,
      attrs: {
        xml: { default: '' },
        svg: { default: '' },
        ...blockAttrs,
      },
    },
    gaussianSplat: {
      group: 'block',
      atom: true,
      attrs: {
        src: { default: '' },
        preview: { default: '' },
        ...blockAttrs,
      },
    },
    table: {
      group: 'block',
      content: 'tableRow+',
      attrs: { ...blockAttrs },
    },
    tableRow: {
      content: '(tableCell | tableHeader)+',
    },
    tableCell: {
      content: 'block+',
      attrs: { ...tableCellAttrs },
      isolating: true,
    },
    tableHeader: {
      content: 'block+',
      attrs: { ...tableCellAttrs },
      isolating: true,
    },
  },
  marks: {
    bold: {},
    italic: {},
    strike: {},
    underline: {},
    code: {},
    link: {
      attrs: {
        href: { default: null },
        target: { default: null },
        rel: { default: null },
      },
    },
    textStyle: {
      attrs: {
        color: { default: null },
      },
    },
    highlight: {
      attrs: {
        color: { default: null },
      },
    },
  },
});
