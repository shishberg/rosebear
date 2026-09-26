import {test,expect,type Page} from '@playwright/test';
async function selectPoint(page:Page,i:number){await page.locator('#edit').check();const p=await page.evaluate(i=>(window as any).rosebearEditor.projectPoint(i),i);await page.mouse.click(p.x,p.y)}
async function selectComponent(page:Page,name:string){await page.locator('#move-components').check();const p=await page.evaluate(name=>(window as any).rosebearEditor.componentScreen(name),name);await page.mouse.click(p.x,p.y)}

test('live plane dragging, rebuild, failure report, undo, persistence and file roundtrip',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('/');
 await expect(page.locator('#view-state')).toContainText('Cut shell rebuilt',{timeout:30000});
 await expect(page.locator('#fit-badge')).toHaveText('Clearance checks FAIL');await expect(page.locator('#fit-list')).toContainText('Middle thumb · 1.5u');
 await page.locator('[data-view="Top"]').click();
 const initial=await page.evaluate(()=>{const e=(window as any).rosebearEditor,p=e.getProject(),i=p.cage.control_ids.indexOf('top:thumb_home_front');return {i,p:p.cage.positions_mm[i],screen:e.projectPoint(i),normal:e.viewNormal()}});
 await page.mouse.move(initial.screen.x,initial.screen.y);await page.mouse.down();await page.mouse.move(initial.screen.x+18,initial.screen.y-12,{steps:4});
 await expect(page.locator('#view-state')).toContainText('showing previous cutouts');await expect(page.locator('#stl')).toBeDisabled();
 const during=await page.evaluate((i)=>(window as any).rosebearEditor.getProject().cage.positions_mm[i],initial.i);
 expect(during).not.toEqual(initial.p);expect(Math.abs(during.reduce((s:number,x:number,i:number)=>s+(x-initial.p[i])*initial.normal[i],0))).toBeLessThan(1e-6);
 await page.mouse.up();await expect(page.locator('#view-state')).toContainText('Cut shell rebuilt',{timeout:30000});
 const after=await page.evaluate((i)=>(window as any).rosebearEditor.getProject().cage.positions_mm[i],initial.i);expect(after).toEqual(during);
 await page.reload();await expect(page.locator('#view-state')).toContainText('Cut shell rebuilt',{timeout:30000});
 expect(await page.evaluate((i)=>(window as any).rosebearEditor.getProject().cage.positions_mm[i],initial.i)).toEqual(after);
 await selectPoint(page,initial.i);const beforeZ=after[2];await page.locator('#coord-Z').fill(String(beforeZ+1));await page.locator('#coord-Z').press('Tab');
 await page.locator('#undo').click();expect(await page.locator('#coord-Z').inputValue()).toBe(beforeZ.toFixed(2));
 await page.locator('#redo').click();expect(await page.locator('#coord-Z').inputValue()).toBe((beforeZ+1).toFixed(2));
 const download=page.waitForEvent('download');await page.locator('#export').click();const file=await download;expect(file.suggestedFilename()).toBe('rosebear-chassis-project.json');
 await page.locator('#file').setInputFiles((await file.path())!);await expect(page.locator('#load-error')).toHaveText('');
 await expect(page.locator('#view-state')).toContainText('Cut shell rebuilt',{timeout:30000});
 await page.locator('#opacity').fill('0.9');await page.locator('#caps').check();await page.locator('[data-view="3D"]').click();await page.screenshot({path:'test-results/editor.png',fullPage:true});
 expect(errors).toEqual([]);
});
test('oblique dragging preserves view depth and invalid imports leave the project intact',async({page})=>{
 await page.goto('/');await expect(page.locator('#view-state')).toContainText('Cut shell rebuilt',{timeout:30000});
 const before=await page.evaluate(()=>{const e=(window as any).rosebearEditor,p=e.getProject(),i=p.cage.control_ids.indexOf('top:thumb_far_front');return {i,position:p.cage.positions_mm[i],screen:e.projectPoint(i),normal:e.viewNormal()}});
 await page.mouse.move(before.screen.x,before.screen.y);await page.mouse.down();await page.mouse.move(before.screen.x+10,before.screen.y-8,{steps:3});await page.mouse.up();
 const moved=await page.evaluate((i)=>(window as any).rosebearEditor.getProject().cage.positions_mm[i],before.i);
 const delta=moved.map((x:number,i:number)=>x-before.position[i]);expect(Math.hypot(...delta)).toBeGreaterThan(.5);expect(Math.abs(delta[2])).toBeGreaterThan(.1);expect(Math.abs(delta.reduce((s:number,x:number,i:number)=>s+x*before.normal[i],0))).toBeLessThan(1e-6);
 await page.locator('#undo').click();await expect(page.locator('#redo')).toBeEnabled();
 const screen=await page.evaluate((i)=>(window as any).rosebearEditor.projectPoint(i),before.i);await page.mouse.click(screen.x,screen.y);await expect(page.locator('#redo')).toBeEnabled();
 const initial=await page.evaluate(()=>(window as any).rosebearEditor.getProject());
 await page.locator('#file').setInputFiles({name:'invalid.json',mimeType:'application/json',buffer:Buffer.from('{"version":999}')});
 await expect(page.locator('#load-error')).toContainText('Not a Rosebear editor project');expect(await page.evaluate(()=>(window as any).rosebearEditor.getProject())).toEqual(initial);
 await expect(page.locator('#view-state')).toContainText('Cut shell rebuilt',{timeout:30000});
 await page.locator('#edit').uncheck();await page.screenshot({path:'test-results/opaque.png',fullPage:true});
});
test('a newer edit supersedes an in-flight solid build',async({page})=>{
 await page.goto('/');await expect(page.locator('#view-state')).toContainText('Cut shell rebuilt',{timeout:30000});
 const i=await page.evaluate(()=>(window as any).rosebearEditor.getProject().cage.control_ids.indexOf('top:thumb_home_front'));
 await selectPoint(page,i);const field=page.locator('#coord-Z'),z=Number(await field.inputValue());
 await field.fill(String(z+.5));await field.press('Tab');await page.locator('#rebuild').click();
 await field.fill(String(z+1));await field.press('Tab');await field.fill(String(z+1.5));await field.press('Tab');
 await expect(page.locator('#stl')).toBeDisabled();await expect(page.locator('#view-state')).toContainText('Cut shell rebuilt',{timeout:30000});
 expect(await page.evaluate(()=>{const e=(window as any).rosebearEditor;return e.getRevision()===e.getSolidRevision()})).toBe(true);
 expect(Number(await field.inputValue())).toBeCloseTo(z+1.5,2);
 const reportDownload=page.waitForEvent('download');await page.locator('#report').click();const file=await reportDownload;
 const fs=await import('node:fs/promises'),saved=JSON.parse(await fs.readFile((await file.path())!,'utf8'));expect(saved.evaluatedProject.cage.positions_mm[i][2]).toBeCloseTo(z+1.5,2);
 const stl=page.waitForEvent('download');await page.locator('#stl').click();const solid=await stl;const bytes=await fs.readFile((await solid.path())!);expect(bytes.length).toBe(84+50*bytes.readUInt32LE(80));
});

test('clearance overlays isolate collisions, toggle, and clear on edit',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('/');
 await expect(page.locator('#view-state')).toContainText('Cut shell rebuilt',{timeout:30000});
 const highlights=()=>page.evaluate(()=>(window as any).rosebearEditor.getHighlights());
 const all=await highlights();expect(all.length).toBeGreaterThan(1);expect(all.every((h:any)=>h.visible&&h.triangles>0)).toBe(true);
 await page.locator('#fit-list button').filter({hasText:'Middle thumb · 1.5u'}).click();
 let visible=(await highlights()).filter((h:any)=>h.visible);expect(visible.map((h:any)=>h.kind).sort()).toEqual(['rest','travel']);expect(visible.every((h:any)=>h.name==='thumb_home')).toBe(true);
 await page.locator('[data-view="Top"]').click();await page.locator('#edit').uncheck();await page.screenshot({path:'test-results/clearance-thumb.png',fullPage:true});
 await page.locator('#show-failures').uncheck();expect((await highlights()).every((h:any)=>!h.visible)).toBe(true);
 await page.locator('#all-failures').click();expect((await highlights()).every((h:any)=>h.visible)).toBe(true);
 await selectPoint(page,0);const field=page.locator('#coord-Z');await field.fill(String(Number(await field.inputValue())+.1));await field.press('Tab');
 expect(await highlights()).toEqual([]);
 await expect(page.locator('#view-state')).toContainText('Cut shell rebuilt',{timeout:30000});expect((await highlights()).length).toBeGreaterThan(0);expect(errors).toEqual([]);
});
test('layout comparison moves complete assemblies and preserves separate edits',async({page})=>{
 await page.goto('/');await expect(page.locator('#view-state')).toContainText('Cut shell rebuilt',{timeout:30000});
 const baseline=await page.evaluate(()=>(window as any).rosebearEditor.getProject());
 await page.locator('#edit').uncheck();
 for(const id of ['tilt','shift','both']){
  await page.locator('#arrangement').selectOption(id);await expect(page.locator('#view-state')).toContainText('Cut shell rebuilt',{timeout:30000});
  await page.locator('[data-view="Top"]').click();await page.screenshot({path:`test-results/layout-${id}-top.png`,fullPage:true});
  await page.locator('[data-view="3D"]').click();await page.screenshot({path:`test-results/layout-${id}.png`,fullPage:true});
 }
 expect(await page.evaluate(()=>(window as any).rosebearEditor.getReport().keycaps.find((k:any)=>k.name==='thumb_home').passed)).toBe(true);
 await selectPoint(page,0);const z=Number(await page.locator('#coord-Z').inputValue());await page.locator('#coord-Z').fill(String(z+.1));await page.locator('#coord-Z').press('Tab');
 await page.locator('#arrangement').selectOption('baseline');
 const restored=await page.evaluate(()=>(window as any).rosebearEditor.getProject());expect(restored.cage).toEqual(baseline.cage);expect(restored.config).toEqual(baseline.config);
 await page.locator('#arrangement').selectOption('both');await page.reload();await expect(page.locator('#view-state')).toContainText('Cut shell rebuilt',{timeout:30000});
 await expect(page.locator('#arrangement')).toHaveValue('both');
 expect(await page.evaluate(()=>(window as any).rosebearEditor.getProject().cage.positions_mm[0][2])).toBeCloseTo(z+.1,2);
});
test('switches follow surface edits and components drag with undo and persistence',async({page})=>{
 await page.goto('/');await expect(page.locator('#view-state')).toContainText('Cut shell rebuilt',{timeout:30000});
 const before=await page.evaluate(()=>{const e=(window as any).rosebearEditor;return {project:e.getProject(),parts:e.getHardware()}});
 const index=before.project.cage.control_ids.indexOf('top:well_middle_upper');await selectPoint(page,index);
 await page.locator('#coord-Z').fill(String(before.project.cage.positions_mm[index][2]+2));await page.locator('#coord-Z').press('Tab');
 const raised=await page.evaluate(()=>(window as any).rosebearEditor.getHardware());
 expect(raised.find((p:any)=>p.name==='matrix_middle_home'&&p.group==='pcb').matrix).not.toEqual(before.parts.find((p:any)=>p.name==='matrix_middle_home'&&p.group==='pcb').matrix);
 await page.locator('#undo').click();await expect(page.locator('#view-state')).toContainText('Cut shell rebuilt',{timeout:30000});
 await page.locator('[data-view="Top"]').click();await selectComponent(page,'matrix_middle_home');
 const handle=await page.evaluate(()=>(window as any).rosebearEditor.componentScreen());
 await page.mouse.move(handle.x,handle.y);await page.mouse.down();await page.mouse.move(handle.x+7,handle.y-4,{steps:3});await page.mouse.up();
 await expect(page.locator('#view-state')).toContainText('Cut shell rebuilt',{timeout:30000});
 const moved=await page.evaluate(()=>(window as any).rosebearEditor.getProject());expect(moved.cage).toEqual(before.project.cage);expect(moved.config.geometry.key_overrides).not.toEqual(before.project.config.geometry.key_overrides);
 await page.reload();await expect(page.locator('#view-state')).toContainText('Cut shell rebuilt',{timeout:30000});
 expect(await page.evaluate(()=>(window as any).rosebearEditor.getProject().config.geometry.key_overrides)).toEqual(moved.config.geometry.key_overrides);
 await selectComponent(page,'trackball_group');await page.locator('[data-view="Top"]').click();
 const ball=await page.evaluate(()=>(window as any).rosebearEditor.componentScreen());await page.mouse.move(ball.x,ball.y);await page.mouse.down();await page.mouse.move(ball.x,ball.y-5,{steps:2});await page.mouse.up();
 const shifted=await page.evaluate(()=>(window as any).rosebearEditor.getProject());const dy=shifted.config.trackball.position_mm[1]-moved.config.trackball.position_mm[1];expect(dy).toBeGreaterThan(0);expect(shifted.config.adapter.position_mm[1]-moved.config.adapter.position_mm[1]).toBeCloseTo(dy,6);expect(shifted.cage).not.toEqual(moved.cage);
 await page.locator('#undo').click();expect(await page.evaluate(()=>(window as any).rosebearEditor.getProject().cage)).toEqual(moved.cage);
 await expect(page.locator('#view-state')).toContainText('Cut shell rebuilt',{timeout:30000});await page.screenshot({path:'test-results/component-drag.png',fullPage:true});
});

test('direct picking keeps both editing modes available and outlines move over retained cutouts',async({page})=>{
 await page.goto('/');await expect(page.locator('#view-state')).toContainText('Cut shell rebuilt',{timeout:30000});
 await expect(page.locator('select#component,select#selection')).toHaveCount(0);
 await expect(page.locator('#edit')).toBeChecked();await expect(page.locator('#move-components')).toBeChecked();
 await page.locator('[data-view="Top"]').click();await page.locator('#parts').uncheck();await page.locator('#caps').uncheck();
 const before=await page.evaluate(()=>{const e=(window as any).rosebearEditor;return {shell:e.getShellId(),builds:e.getBuildRequests(),handle:e.componentScreen('matrix_middle_home')}});
 await page.mouse.move(before.handle.x,before.handle.y);await page.mouse.down();await page.mouse.move(before.handle.x+6,before.handle.y-3,{steps:3});
 await expect(page.locator('#component')).toHaveText('matrix middle home');
 const moving=await page.evaluate(()=>{const e=(window as any).rosebearEditor;return {shell:e.getShellId(),builds:e.getBuildRequests(),outline:e.getOutline()}});
 expect(moving.shell).toBe(before.shell);expect(moving.builds).toBe(before.builds);expect(moving.outline.visible).toBe(true);expect(moving.outline.parts.map((p:any)=>p.group).sort()).toEqual(['keycaps','pcb']);expect(moving.outline.parts.every((p:any)=>!p.depthTest)).toBe(true);
 await page.screenshot({path:'test-results/drag-outline.png',fullPage:true});
 await page.mouse.up();expect(await page.evaluate(()=>(window as any).rosebearEditor.getShellId())).toBe(before.shell);
 await expect(page.locator('#view-state')).toContainText('Cut shell rebuilt',{timeout:30000});expect(await page.evaluate(()=>(window as any).rosebearEditor.getShellId())).not.toBe(before.shell);
 await selectComponent(page,'matrix_ring_home');await expect(page.locator('#component')).toHaveText('matrix ring home');
 await expect(page.locator('#edit')).toBeChecked();await selectPoint(page,0);await expect(page.locator('#move-components')).toBeChecked();
 const thumb=await page.evaluate(()=>(window as any).rosebearEditor.componentScreen('thumb_home'));await page.keyboard.down('Shift');await page.mouse.click(thumb.x,thumb.y);await page.keyboard.up('Shift');
 await expect(page.locator('#component')).toHaveText('thumb cluster');
 expect(await page.evaluate(()=>(window as any).rosebearEditor.getOutline().parts.length)).toBe(6);
});
