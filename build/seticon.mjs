import * as ResEdit from 'resedit';
import fs from 'fs';
const [,, exePath, icoPath, version] = process.argv;
const exe = ResEdit.NtExecutable.from(fs.readFileSync(exePath), { ignoreCert: true });
const res = ResEdit.NtExecutableResource.from(exe);
const ico = ResEdit.Data.IconFile.from(fs.readFileSync(icoPath));
const groups = ResEdit.Resource.IconGroupEntry.fromEntries(res.entries);
const id = groups.length ? groups[0].id : 1, lang = groups.length ? groups[0].lang : 1033;
ResEdit.Resource.IconGroupEntry.replaceIconsForResource(res.entries, id, lang, ico.icons.map(i => i.data));
const vi = ResEdit.Resource.VersionInfo.fromEntries(res.entries)[0];
if (vi) {
  vi.setStringValues({ lang: 1033, codepage: 1200 }, { ProductName: 'SPACEBASE Schedule', FileDescription: 'SPACEBASE Schedule', CompanyName: 'SPACEBASE', OriginalFilename: 'SPACEBASE Schedule.exe', InternalName: 'SPACEBASE Schedule' });
  const [a,b,c] = version.split('.').map(Number);
  vi.setFileVersion(a,b,c,0,1033); vi.setProductVersion(a,b,c,0,1033);
  vi.outputToResourceEntries(res.entries);
}
res.outputResource(exe);
fs.writeFileSync(exePath, Buffer.from(exe.generate()));
console.log('icon set');
