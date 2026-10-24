# Bugs

# MAJOR

## General
- "I added a ProseMirror trim pass that removes extra trailing empty paragraphs in the editor itself (including collab), so the doc can’t accumulate blank lines on refresh. This should stop the “new empty line every refresh” behavior." 
^ that has now made it impossible to add extra paragraphs, also does not really fix the core issue which was causing the new paragraphs to be created, as now a single empty paragraph is created every time i refresh a page, but is just limited to one extra line :L

## Collaboration
- New line appears temporarily when rearranging blocks
- Cursors show behind text 

## Code Block
- I think it's missing some languages (e.g. lua)

# Minor
## Save Status
- Saved status flips to "Saving" as soon as page is opened
- Document name in sidebar flashes something when opening

## Image block
- Weird padding (not enough space above image, handle is weirdly aligned to the image, as if it's aligning to the block and not the image itself)
- Text bubble menu appears when clicking image

# Done
- Title and emoji in public pages change doesn't trigger 'Saving...' status
- Page titles not updating until refresh
- ~Page refresh doesn't stay on the same doc~ - page id in url?
- Page titles not saving if switching pages too fast after editing - fixed by hocuspocus
- Code blocks not showing lang in block, but in tuning handle instead 