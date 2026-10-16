// Saving and opening: project JSON, the clearance report and the review STLs.
import * as T from 'three';
import { STLExporter } from 'three/addons/exporters/STLExporter.js';
import { $, S } from './state';
import { shell, basePlate } from './viewer';
import { commit } from './project-store';

function download(name: string, data: BlobPart, type: string) {
  const url = URL.createObjectURL(new Blob([data], { type })),
    a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
$('export').onclick = () =>
  download('rosebear-chassis-project.json', JSON.stringify(S.project, null, 2), 'application/json');
$('report').onclick = () => {
  if (S.solidRevision === S.revision && S.report && S.evaluated)
    download(
      'rosebear-clearance-report.json',
      JSON.stringify({ report: S.report, evaluatedProject: S.evaluated }, null, 2),
      'application/json',
    );
};
const exportStl = (id: string, name: string, mesh: T.Mesh) =>
  ($(id).onclick = () => {
    if (S.solidRevision !== S.revision) return;
    download(
      name,
      new STLExporter().parse(mesh, { binary: true }) as DataView<ArrayBuffer>,
      'application/octet-stream',
    );
  });
exportStl('stl', 'rosebear-right-review.stl', shell);
exportStl('stl-base', 'rosebear-right-bottom.stl', basePlate);
$('import').onclick = () => $<HTMLInputElement>('file').click();
$('file').onchange = async () => {
  const input = $<HTMLInputElement>('file'),
    file = input.files?.[0];
  if (!file) return;
  try {
    if (file.size > 2_000_000) throw Error('Project file exceeds 2 MB');
    const next = JSON.parse(await file.text());
    commit(next, true);
    $('load-error').textContent = '';
  } catch (e) {
    $('load-error').textContent = String(e);
  } finally {
    input.value = '';
  }
};
