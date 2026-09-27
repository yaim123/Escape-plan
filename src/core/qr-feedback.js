// Counts come from the scanned mission's server receipt, never the next block's QR list.
export function qrSuccessDetail(progress) {
 if(!progress||progress.mode==='ANY')return '';
 if(!['ALL','N_OF_M','UNIQUE_MEMBER'].includes(progress.mode)||!Number.isInteger(progress.found)||progress.found<0||!Number.isInteger(progress.required)||progress.required<1)return '';
 if(progress.mode==='UNIQUE_MEMBER'&&progress.selfDone)return `내 QR 찾기 완료\n현재 팀 진행: ${progress.found} / ${progress.required}명\n${progress.done?'팀의 QR 찾기를 완료했습니다.':'다른 팀원이 QR을 찾을 때까지 기다려주세요.'}`;
 return `현재 ${progress.found} / ${progress.required}개 발견`;
}
