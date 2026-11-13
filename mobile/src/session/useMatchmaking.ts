import { useCallback, useEffect, useReducer, useRef } from 'react';

import { WS_URL } from '../config';
import type { Identity } from '../identity';
import type { Answer, ClientMsg, ServerMsg } from './protocol';
import { initialState, reduce } from './reducer';

const PING_MS = 10_000; // the server drops a socket that is silent for 30 s
const RETRY_MS = [500, 1000, 2000, 4000];

/**
 * One WebSocket for the whole app. Sends the user's commands, feeds every
 * server message to the reducer, and reconnects when the link drops.
 */
export function useMatchmaking(identity: Identity | null) {
  const [state, dispatch] = useReducer(reduce, initialState);
  const socket = useRef<WebSocket | null>(null);

  const send = useCallback((msg: ClientMsg): boolean => {
    const ws = socket.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    ws.send(JSON.stringify(msg));
    return true;
  }, []);

  useEffect(() => {
    if (!identity) return;
    let closed = false;
    let attempt = 0;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let ping: ReturnType<typeof setInterval> | undefined;

    const connect = () => {
      dispatch({ type: 'link', link: 'connecting', now: Date.now() });
      const url = `${WS_URL}/ws?user_id=${encodeURIComponent(identity.id)}&name=${encodeURIComponent(identity.name)}`;
      const ws = new WebSocket(url);
      socket.current = ws;
      let replaced = false;

      ws.onopen = () => {
        attempt = 0;
        ping = setInterval(() => ws.readyState === WebSocket.OPEN && ws.send('{"type":"ping"}'), PING_MS);
      };
      ws.onmessage = (event) => {
        let msg: ServerMsg;
        try {
          msg = JSON.parse(String(event.data)) as ServerMsg;
        } catch {
          return;
        }
        if (msg.type === 'replaced') replaced = true;
        // A fresh socket always starts on the start screen. If the server still
        // has this user somewhere (another device took over mid-wait), leave,
        // so what the server believes matches what this screen shows.
        if (msg.type === 'hello' && msg.state.phase !== 'idle') ws.send('{"type":"leave"}');
        dispatch({ type: 'server', msg, now: Date.now() });
      };
      ws.onclose = () => {
        clearInterval(ping);
        if (socket.current === ws) socket.current = null;
        if (closed) return;
        if (replaced) return; // signed in elsewhere: do not fight the other device for the socket
        dispatch({ type: 'link', link: 'offline', now: Date.now() });
        retry = setTimeout(connect, RETRY_MS[Math.min(attempt++, RETRY_MS.length - 1)]);
      };
      ws.onerror = () => {
        // onclose follows and does the work.
      };
    };

    connect();
    return () => {
      closed = true;
      clearTimeout(retry);
      clearInterval(ping);
      socket.current?.close();
      socket.current = null;
    };
    // Reconnect when the name changes: the server reads it from the URL.
  }, [identity?.id, identity?.name]);

  const join = useCallback(
    (languages: string[], topic: string | null) => {
      if (send({ type: 'join', languages, topic })) dispatch({ type: 'join_sent' });
    },
    [send],
  );
  const cancel = useCallback(() => {
    if (send({ type: 'leave' })) dispatch({ type: 'leave_sent' });
  }, [send]);
  const respond = useCallback(
    (matchId: number, answer: Answer, neverAgain = false) => {
      if (send({ type: 'respond', match_id: matchId, answer, never_again: neverAgain })) {
        dispatch({ type: 'answer_sent', answer, neverAgain });
      }
    },
    [send],
  );
  const endCall = useCallback(() => void send({ type: 'end_call' }), [send]);
  const dismissNotice = useCallback(() => dispatch({ type: 'dismiss_notice' }), []);

  return { state, join, cancel, respond, endCall, dismissNotice };
}
