export function authErrorMessage(error) {
  const messages = {
    invalid_credentials: '이메일 또는 비밀번호가 올바르지 않습니다. Supabase 관리 사이트의 계정이 아니라, 이 앱에서 만든 교사 계정으로 로그인하세요.',
    email_not_confirmed: '이메일 인증이 아직 완료되지 않았습니다. 가입 메일의 인증 링크를 누른 뒤 다시 로그인하세요.',
    signup_disabled: '이 Supabase 프로젝트에서 신규 가입이 비활성화되어 있습니다. 프로젝트의 Auth 설정을 확인하세요.',
    email_provider_disabled: '이메일 로그인이 비활성화되어 있습니다. Supabase Auth의 이메일 제공자 설정을 확인하세요.',
    over_email_send_rate_limit: '인증 메일 발송 한도에 도달했습니다. 잠시 후 다시 시도하거나 프로젝트의 메일 발송 설정을 확인하세요.',
    over_request_rate_limit: '요청이 너무 많습니다. 잠시 기다렸다가 다시 시도하세요.',
    email_address_not_authorized: '현재 메일 발송 설정으로는 이 주소에 인증 메일을 보낼 수 없습니다. Supabase의 메일 발송 설정을 확인하세요.',
    email_address_invalid: '사용할 수 없는 이메일 주소입니다. 실제로 메일을 받을 수 있는 주소를 입력하세요.',
    weak_password: '비밀번호가 프로젝트의 보안 기준을 충족하지 않습니다. 더 긴 비밀번호를 사용하세요.',
    user_already_exists: '이미 등록된 계정입니다. 로그인으로 진행하세요.',
    captcha_failed: '가입 보안 검증이 필요합니다. 이 앱의 CAPTCHA 연동 상태를 확인해야 합니다.',
    NETWORK_ERROR: '인증 서버에 연결하지 못했습니다. 인터넷 연결과 저장 공간 설정의 프로젝트 주소를 확인하세요.'
  };
  const message = messages[error.code] || error.message || '인증 요청에 실패했습니다.';
  return `${message}${error.code && error.code !== 'NETWORK_ERROR' ? ` (${error.code})` : ''}`;
}
