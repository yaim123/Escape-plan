// Counts come from the scanned mission's server receipt, never the next block's QR list.
export function qrSuccessDetail(progress) {
 if(!progress||progress.mode==='ANY')return '';
 if(!['ALL','N_OF_M','UNIQUE_MEMBER'].includes(progress.mode)||!Number.isInteger(progress.found)||progress.found<0||!Number.isInteger(progress.required)||progress.required<1)return '';
 return `현재 ${progress.found} / ${progress.required}개 발견`;
}
