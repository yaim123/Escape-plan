// Supabase Realtime / Phoenix protocol v1. Only empty invalidations are trusted.
// Every broadcast causes a bounded, authorized RPC read, never a local mutation.
export function watchLobby(config, topic, onChange, onStatus, WebSocketClass = globalThis.WebSocket) {
  let socket, retry, heartbeat, deadline, stopped = false, attempts = 0, ref = 0, pendingHeartbeat;
  const channel = `realtime:${topic}`;
  const send = (event, payload, target = channel, reference = String(++ref)) => {
    socket.send(JSON.stringify({ topic: target, event, payload, ref: reference, ...(target === channel ? { join_ref: '1' } : {}) }));
    return reference;
  };
  const connect = () => {
    if (stopped) return;
    onStatus('connecting');
    const url = new URL(config.url.replace(/^http/, 'ws') + '/realtime/v1/websocket');
    url.searchParams.set('apikey', config.key); url.searchParams.set('vsn', '1.0.0');
    socket = new WebSocketClass(url.href); ref = 1;
    deadline = setTimeout(() => socket.close(), 12000);
    socket.onopen = () => send('phx_join', { config: { broadcast: { ack: false, self: false }, presence: { enabled: false }, private: false } }, channel, '1');
    socket.onmessage = event => {
      let message; try { message = JSON.parse(event.data); } catch { return; }
      if (message.event === 'phx_reply' && message.ref === pendingHeartbeat) pendingHeartbeat = null;
      if (message.topic !== channel) return;
      if (message.event === 'phx_reply' && message.ref === '1') {
        clearTimeout(deadline);
        if (message.payload?.status !== 'ok') { onStatus('error'); socket.close(); return; }
        attempts = 0; pendingHeartbeat = null; onStatus('connected'); onChange();
        heartbeat = setInterval(() => {
          if (pendingHeartbeat) { socket.close(); return; }
          pendingHeartbeat = send('heartbeat', {}, 'phoenix');
        }, 25000);
      }
      if (message.event === 'broadcast' && message.payload?.event === 'changed') onChange();
      if (['phx_error', 'phx_close'].includes(message.event)) socket.close();
    };
    socket.onerror = () => onStatus('error');
    socket.onclose = () => {
      clearTimeout(deadline); clearInterval(heartbeat);
      if (!stopped) { onStatus('reconnecting'); retry = setTimeout(connect, Math.min(15000, 1000 * 2 ** attempts++)); }
    };
  };
  connect();
  return () => { stopped = true; clearTimeout(retry); clearTimeout(deadline); clearInterval(heartbeat); socket?.close(); };
}
