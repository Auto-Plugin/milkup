import hashlib,json,pathlib,re,subprocess,tempfile,unittest
import rebase_current,prepare,restore_sources
HERE=pathlib.Path(__file__).resolve().parent
class CurrentRebase(unittest.TestCase):
 def test_exact_source_and_preserved_new_api(self):
  with tempfile.TemporaryDirectory()as t:
   root=pathlib.Path(t);tree=root/'tree'
   source=restore_sources.restore('2.54.2',root/'current-source');old=restore_sources.restore('2.52.6',root/'old-source');normal=root/'normal'
   prepare.build(old,root/'old.patch',normal)
   r=rebase_current.build(source,normal,root/'current.patch',tree)
   self.assertEqual((root/'current.patch').read_bytes(),(HERE/'normal-path-2.54.2.patch').read_bytes())
   c=(tree/'Source/WebCore/platform/graphics/FontCascade.cpp').read_text()
   body=c[c.index('RefPtr<const DisplayList::DisplayList> FontCascade::displayListForGlyphBuffer'):c.index('float FontCascade::widthOfTextRange')]
   self.assertNotIn('&run',body);self.assertNotIn('destination',body)
   self.assertIn('sourceRun, sourceFrom, sourceTo',body)
   self.assertIn('Ref fontData = glyphBuffer.fontAt(0)',c);self.assertIn('drawSpan(fontData.get()',c)
   outline=(tree/'Source/WebCore/rendering/OutlinePainter.cpp').read_text()
   self.assertIn('encodingParseURL(href)',outline);self.assertNotIn('completeURL(href)',outline)
   row=(tree/'Source/WebCore/rendering/RenderTableSection.cpp').read_text()
   self.assertLess(row.index('PrintFragmentPolicy::rowShift'),row.index('auto layoutCells ='))
   self.assertLess(row.index('auto layoutCells ='),row.index('LayoutStateMaintainer rowStatePusher'))
   self.assertIn('rowHeightIncreaseForPagination',row)
   self.assertIn('m_currentBorder = nullptr;', (tree/'Source/WebCore/rendering/RenderTable.cpp').read_text())
   # Compiler-level pure contracts use the actual rebased production headers.
   for source in [HERE/'test_link_policy.cpp',HERE.parent/'pdf-pagination-behavior-20261116/test_policy.cpp']:
    out=root/source.stem
    subprocess.run(['c++','-std=c++20','-Wall','-Wextra','-Werror','-I'+str(tree/'Source/WebCore/rendering'),str(source),'-o',str(out)],check=True,timeout=30)
    subprocess.run([str(out)],check=True,timeout=5)
   self.assertEqual(len(r['outputs']),22)
if __name__=='__main__':unittest.main()
