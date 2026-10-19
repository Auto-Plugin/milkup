# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: desktop-markdown-extensions.spec.ts >> ordinary proxy focus retains Tab indentation (false)
- Location: tests/e2e/desktop-markdown-extensions.spec.ts:741:3

# Error details

```
Error: keyboard.press: Test ended.
```

# Test source

```ts
  650 |       const view = windowed
  651 |         ? new SourceDocumentView({
  652 |             ...options,
  653 |             source,
  654 |             onEdit: (edit: any) => {
  655 |               edits.push(edit)
  656 |               version++
  657 |               state = state.applyTransaction({
  658 |                 changes: ChangeSet.of([{ from: edit.from, to: edit.to, insert: edit.insert }]),
  659 |                 selection: edit.selectionAfter,
  660 |               })
  661 |               memory = new MemoryDocumentSource({
  662 |                 documentId: source.documentId,
  663 |                 document: state.doc,
  664 |                 version: version,
  665 |               })
  666 |             },
  667 |           })
  668 |         : new EditorView({
  669 |             ...options,
  670 |             state,
  671 |             dispatch: (transaction: any, activeView: any) => {
  672 |               if (transaction.changes && !transaction.changes.empty) {
  673 |                 edits.push(transaction)
  674 |                 version++
  675 |               }
  676 |               state = state.applyTransaction(transaction)
  677 |               activeView.updateState(state, [transaction])
  678 |             },
  679 |           })
  680 |       if (windowed) await view.revealSelection(1, Selection.cursor(2))
  681 |       ;(window as any).lastReferenceProbe = {
  682 |         view,
  683 |         edits,
  684 |         text,
  685 |         read: () => {
  686 |           const current = windowed ? state : view.state
  687 |           return {
  688 |             text: current.doc.text,
  689 |             version,
  690 |             historyText: current.undo().doc.text,
  691 |             undoCount: current.history.undoStack.length,
  692 |             redoCount: current.history.redoStack.length,
  693 |             edits: edits.length,
  694 |             selection: (windowed ? view.selection : current.selection).main,
  695 |           }
  696 |         },
  697 |       }
  698 |     },
  699 |     {
  700 |       windowed,
  701 |       viewModule: `/@fs${resolve('packages/view-dom/src/index.ts')}`,
  702 |       coreModule: `/@fs${resolve('packages/core/src/index.ts')}`,
  703 |     },
  704 |   )
  705 |   await expect(page.locator('[data-last-reference-probe] .milkup-document-reference')).toHaveCount(
  706 |     1,
  707 |   )
  708 | }
  709 | 
  710 | for (const windowed of [false, true]) {
  711 |   test(`last preview reference supports native Tab round trip (${windowed})`, async ({ page }) => {
  712 |     await lastReferenceFixture(page, windowed)
  713 |     const reference = page.locator('[data-last-reference-probe] .milkup-document-reference')
  714 |     const input = page.locator('[data-last-reference-probe] .milkup-input-proxy')
  715 |     const before = await page.evaluate(() => (window as any).lastReferenceProbe.read())
  716 |     await reference.focus()
  717 |     await page.keyboard.press('Tab')
  718 |     await expect(input).toBeFocused()
  719 |     await page.keyboard.press('Shift+Tab')
  720 |     const after = await page.evaluate(async () => {
  721 |       const probe = (window as any).lastReferenceProbe
  722 |       if (probe.view.runAfterPendingEdits) await probe.view.runAfterPendingEdits(async () => {})
  723 |       return probe.read()
  724 |     })
  725 |     await writeFile(
  726 |       test.info().outputPath('last-reference-tab-state.json'),
  727 |       JSON.stringify({ before, after }, null, 2),
  728 |     )
  729 |     await test.info().attach('last-reference-tab-state', {
  730 |       body: JSON.stringify({ before, after }),
  731 |       contentType: 'application/json',
  732 |     })
  733 |     await expect(reference).toBeFocused()
  734 |     expect(after).toEqual(before)
  735 |     await page.screenshot({
  736 |       path: test.info().outputPath('last-reference-tab-after.png'),
  737 |       fullPage: true,
  738 |     })
  739 |   })
  740 | 
  741 |   test(`ordinary proxy focus retains Tab indentation (${windowed})`, async ({ page }) => {
  742 |     await lastReferenceFixture(page, windowed)
  743 |     const input = page.locator('[data-last-reference-probe] .milkup-input-proxy')
  744 |     await input.focus()
  745 |     await page.keyboard.press('Tab')
  746 |     await expect
  747 |       .poll(() => page.evaluate(() => (window as any).lastReferenceProbe.read().text))
  748 |       .toBe('    编辑 中文😀\r\n引用[^only]')
  749 |     await expect(input).toBeFocused()
> 750 |     await page.keyboard.press('Shift+Tab')
      |                         ^ Error: keyboard.press: Test ended.
  751 |     await expect
  752 |       .poll(() => page.evaluate(() => (window as any).lastReferenceProbe.read().text))
  753 |       .toBe('  编辑 中文😀\r\n引用[^only]')
  754 |     await expect(input).toBeFocused()
  755 |   })
  756 | }
  757 | 
  758 | for (const windowed of [false, true])
  759 |   for (const intervention of ['arrow', 'text', 'pointer', 'external-focus', 'replacement'])
  760 |     test(`preview proxy navigation ends after ${intervention} (${windowed})`, async ({ page }) => {
  761 |       await lastReferenceFixture(page, windowed)
  762 |       const reference = page.locator('[data-last-reference-probe] .milkup-document-reference')
  763 |       const input = page.locator('[data-last-reference-probe] .milkup-input-proxy')
  764 |       await reference.focus()
  765 |       await page.keyboard.press('Tab')
  766 |       await expect(input).toBeFocused()
  767 |       if (intervention === 'arrow') await page.keyboard.press('ArrowRight')
  768 |       else if (intervention === 'text') {
  769 |         await page.keyboard.insertText('X')
  770 |         await expect
  771 |           .poll(() => page.evaluate(() => (window as any).lastReferenceProbe.read().text))
  772 |           .toBe('  X编辑 中文😀\r\n引用[^only]')
  773 |       } else if (intervention === 'pointer') await input.click({ force: true })
  774 |       else if (intervention === 'external-focus') {
  775 |         await page.getByRole('button', { name: '菜单', exact: true }).focus()
  776 |         await input.focus()
  777 |       } else {
  778 |         const previous = await reference.elementHandle()
  779 |         await page.evaluate(() =>
  780 |           (window as any).lastReferenceProbe.view.refreshDocumentPresentation(),
  781 |         )
  782 |         await expect.poll(() => previous!.evaluate((element) => element.isConnected)).toBe(false)
  783 |         await expect(reference).toHaveCount(1)
  784 |         await expect(input).toBeFocused()
  785 |       }
  786 |       await page.keyboard.press('Shift+Tab')
  787 |       await expect
  788 |         .poll(() => page.evaluate(() => (window as any).lastReferenceProbe.read().text))
  789 |         .toBe(`${intervention === 'text' ? 'X' : ''}编辑 中文😀\r\n引用[^only]`)
  790 |       await expect(input).toBeFocused()
  791 |     })
  792 | 
  793 | for (const anchoring of ['auto', 'none'])
  794 |   for (const windowed of [false, true])
  795 |     test(`timed-out preparation preserves the uncached near-end reading position (${windowed}, ${anchoring})`, async ({
  796 |       page,
  797 |     }) => {
  798 |       await page.setViewportSize({ width: 1100, height: 760 })
  799 |       await page.goto('/')
  800 |       await page.evaluate(
  801 |         async ({ viewModule, coreModule, windowed, anchoring }) => {
  802 |           const { EditorView, SourceDocumentView } = await import(viewModule)
  803 |           const { EditorState, MemoryTextDocument, MemoryDocumentSource, Selection } = await import(
  804 |             coreModule
  805 |           )
  806 |           const text = [
  807 |             ...Array(118).fill('retained 中文😀 body'),
  808 |             'SAMPLE-REMOTE',
  809 |             'final [reference]',
  810 |           ].join('\r\n')
  811 |           const from = text.indexOf('SAMPLE-REMOTE')
  812 |           const source = new MemoryDocumentSource({ documentId: 'notice-layout', text })
  813 |           const mount = document.createElement('main')
  814 |           mount.dataset.noticeLayoutProbe = ''
  815 |           Object.assign(mount.style, {
  816 |             position: 'fixed',
  817 |             inset: '37px 0 30px',
  818 |             zIndex: '10000',
  819 |             background: 'white',
  820 |           })
  821 |           document.body.append(mount)
  822 |           const selection = Selection.range(from, from + 'SAMPLE-REMOTE'.length)
  823 |           const view = windowed
  824 |             ? new SourceDocumentView({ parent: mount, source, mode: 'live', editable: true })
  825 |             : new EditorView({
  826 |                 parent: mount,
  827 |                 mode: 'live',
  828 |                 state: new EditorState({ doc: new MemoryTextDocument(text), selection }),
  829 |               })
  830 |           view.dom.style.overflowAnchor = anchoring
  831 |           if (windowed) await view.revealSelection(119, selection)
  832 |           else {
  833 |             view.dom.scrollTop = view.dom.scrollHeight
  834 |             view.ensureCursorVisible()
  835 |           }
  836 |           await new Promise((resolve) =>
  837 |             requestAnimationFrame(() => requestAnimationFrame(resolve)),
  838 |           )
  839 |           const observations: any[] = [],
  840 |             requests: any[] = []
  841 |           const observe = (reason: string) => {
  842 |             const target = view.contentDOM.querySelector('[data-line="119"]')
  843 |             const rect = target?.getBoundingClientRect(),
  844 |               root = view.dom.getBoundingClientRect()
  845 |             const notice = view.dom.querySelector('[data-document-presentation-notice]')
  846 |             observations.push({
  847 |               reason,
  848 |               at: performance.now(),
  849 |               scrollTop: view.dom.scrollTop,
  850 |               scrollHeight: view.dom.scrollHeight,
```