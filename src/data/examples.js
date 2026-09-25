import { newRoom, newBlock } from '../core/model.js';
export function exampleRoom() {
  const r = newRoom('사라진 연구원의 비밀');
  r.description = '멈춰버린 연구실, 책상 위에 남겨진 단서. 소화의 원리를 밝혀 마지막 문을 열어보세요.';
  r.subject = '과학';
  const intro = newBlock('story'); Object.assign(intro, { title: '아무도 없는 연구실', body: '방과 후, 과학실에서 이상한 불빛이 새어 나옵니다.\n\n문을 여는 순간 들려오는 잠금 소리. 책상에는 연구원의 노트 한 권만 남아 있습니다.\n\n“내 연구를 이해하는 사람만이 이곳을 나갈 수 있다.”', display: 'theme', buttonText: '연구 노트를 펼친다' });
  const q1 = newBlock(); Object.assign(q1, { title: '노트에 남은 첫 번째 단서', body: '녹말이 소화되어 만들어지는 최종 산물은 무엇일까요?\n연구 노트의 빈칸을 채워주세요.', answers: ['포도당', 'glucose', '글루코스'], hints: ['우리 몸이 에너지원으로 사용하는 단당류입니다.', '정답은 세 글자, ‘포’로 시작합니다.'] });
  const q2 = newBlock(); Object.assign(q2, { title: '영양소가 향하는 곳', body: '소화된 영양소가 주로 흡수되는 기관을 찾아주세요.', questionType: 'choice', options: ['위', '소장', '대장', '식도'], answers: ['소장'], hints: ['안쪽 벽에 융털이 있어 흡수 면적이 넓습니다.'] });
  const q3 = newBlock(); Object.assign(q3, { title: '마지막 잠금장치', body: '소화기관의 이동 순서대로 번호를 연결하세요.\n\n1 · 위\n2 · 입\n3 · 소장\n4 · 식도\n\n네 자리 암호를 입력하면 문이 열립니다.', questionType: 'cipher', answers: ['2413'], hints: ['음식물은 입에서 식도를 거쳐 이동합니다.'] });
  r.content = [intro, q1, q2, q3]; return r;
}
