export function qrFilename(name,format='png') {
 const clean=String(name||'').replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/g,'').trim().replace(/[. ]+$/g,'').slice(0,100).replace(/[. ]+$/g,'')||'QR';
 return `${clean}_QR.${format==='svg'?'svg':'png'}`;
}
export function qrRasterLayout(modules) {
 if(!Number.isInteger(modules)||modules<21||modules>177)throw Error('QR 크기를 확인하세요.');
 const quietModules=4,cellSize=Math.ceil(800/(modules+quietModules*2));
 return {cellSize,margin:quietModules*cellSize,size:(modules+quietModules*2)*cellSize};
}
