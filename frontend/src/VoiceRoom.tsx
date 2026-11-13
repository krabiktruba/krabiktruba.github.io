import { useEffect, useRef, useState } from "react";
import "./VoiceRoom.css";

const API = (import.meta.env.VITE_API_URL || "http://127.0.0.1:8000").replace(/\/+$/, "");

const RTC_CONFIG: RTCConfiguration = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
};

type Peer = { peer_id: string; username: string };
type RemoteAudio = { peerId: string; username: string; stream: MediaStream };
type Meter = { analyser: AnalyserNode; source: MediaStreamAudioSourceNode };

type Signal = {
  type?: string;
  peer_id?: string;
  peers?: Peer[];
  from?: string;
  to?: string;
  username?: string;
  sdp?: RTCSessionDescriptionInit;
  candidate?: RTCIceCandidateInit;
};

function errorMessage(error: unknown): string {
  if (error instanceof DOMException) {
    if (error.name === "NotAllowedError" || error.name === "PermissionDeniedError")
      return "Нет доступа к микрофону. Разреши его в настройках системы.";
    if (error.name === "NotFoundError")
      return "Микрофон не найден.";
    if (error.name === "NotReadableError")
      return "Микрофон занят другой программой.";
  }
  return error instanceof Error ? error.message : "Ошибка голосового подключения.";
}

export default function VoiceRoom({
  channelId,
  channelName,
  username,
  isPrivate = false,
  onInvite,
}: {
  channelId: number;
  channelName: string;
  username: string;
  isPrivate?: boolean;
  onInvite?: () => void;
}) {
  const [joined, setJoined] = useState(false);
  const [busy, setBusy] = useState(false);
  const [muted, setMuted] = useState(false);
  const [deafened, setDeafened] = useState(false);
  const [status, setStatus] = useState("Не подключено");
  const [error, setError] = useState("");
  const [participants, setParticipants] = useState<Peer[]>([]);
  const [remoteAudio, setRemoteAudio] = useState<RemoteAudio[]>([]);
  const [speakingIds, setSpeakingIds] = useState<string[]>([]);
  const [volumes, setVolumes] = useState<Record<string, number>>({});

  const socketRef = useRef<WebSocket | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const peersRef = useRef(new Map<string, RTCPeerConnection>());
  const namesRef = useRef(new Map<string, string>());
  const pendingIceRef = useRef(new Map<string, RTCIceCandidateInit[]>());
  const offersRef = useRef(new Set<string>());
  const peerIdRef = useRef("");
  const audioContextRef = useRef<AudioContext | null>(null);
  const metersRef = useRef(new Map<string, Meter>());
  const audioElementsRef = useRef(new Map<string, HTMLAudioElement>());

  function ensureAudioContext(): AudioContext {
    if (!audioContextRef.current || audioContextRef.current.state === "closed") {
      audioContextRef.current = new AudioContext();
    }
    return audioContextRef.current;
  }

  function stopMeter(id: string) {
    const meter = metersRef.current.get(id);
    if (meter) {
      try { meter.source.disconnect(); } catch { /* already disconnected */ }
      try { meter.analyser.disconnect(); } catch { /* already disconnected */ }
      metersRef.current.delete(id);
    }
    setSpeakingIds((old) => old.filter((item) => item !== id));
  }

  function registerMeter(id: string, stream: MediaStream) {
    stopMeter(id);

    const context = ensureAudioContext();
    const analyser = context.createAnalyser();
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0.65;

    const source = context.createMediaStreamSource(stream);
    source.connect(analyser);
    metersRef.current.set(id, { analyser, source });
  }

  function stopAllMeters(closeContext = false) {
    for (const meter of metersRef.current.values()) {
      try { meter.source.disconnect(); } catch { /* already disconnected */ }
      try { meter.analyser.disconnect(); } catch { /* already disconnected */ }
    }

    metersRef.current.clear();
    setSpeakingIds([]);

    if (closeContext) {
      const context = audioContextRef.current;
      audioContextRef.current = null;
      if (context && context.state !== "closed") {
        void context.close().catch(() => {});
      }
    }
  }

  // Измерение уровня аудиосигнала используется только для определения речи.
  // Сырые данные микрофона никуда отдельно не отправляются.
  useEffect(() => {
    const timer = window.setInterval(() => {
      const active: string[] = [];

      for (const [id, meter] of metersRef.current.entries()) {
        const data = new Uint8Array(meter.analyser.fftSize);
        meter.analyser.getByteTimeDomainData(data);

        let sum = 0;
        for (let i = 0; i < data.length; i++) {
          const sample = (data[i] - 128) / 128;
          sum += sample * sample;
        }

        const rms = Math.sqrt(sum / data.length);
        if (rms > 0.025) active.push(id);
      }

      setSpeakingIds((old) => {
        if (
          old.length === active.length &&
          old.every((id) => active.includes(id))
        ) return old;
        return active;
      });
    }, 120);

    return () => window.clearInterval(timer);
  }, []);

  function send(payload: Record<string, unknown>) {
    const socket = socketRef.current;
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(payload));
    }
  }

  function addParticipant(id: string, name: string) {
    if (!id || id === peerIdRef.current) return;

    namesRef.current.set(id, name || "Участник");
    setParticipants((old) => {
      if (old.some((p) => p.peer_id === id)) {
        return old.map((p) =>
          p.peer_id === id ? { ...p, username: name || p.username } : p
        );
      }
      return [...old, { peer_id: id, username: name || "Участник" }];
    });
  }

  function removeParticipant(id: string) {
    peersRef.current.get(id)?.close();
    peersRef.current.delete(id);
    namesRef.current.delete(id);
    pendingIceRef.current.delete(id);
    offersRef.current.delete(id);
    stopMeter(id);

    audioElementsRef.current.delete(id);
    setVolumes((old) => {
      const next = { ...old };
      delete next[id];
      return next;
    });
    setParticipants((old) => old.filter((p) => p.peer_id !== id));
    setRemoteAudio((old) => old.filter((p) => p.peerId !== id));
  }

  function setParticipantVolume(id: string, value: number) {
    const volume = Math.max(0, Math.min(100, Math.round(value)));
    setVolumes((old) => ({ ...old, [id]: volume }));

    const element = audioElementsRef.current.get(id);
    if (element) element.volume = volume / 100;
  }

  function makePeer(id: string, name: string): RTCPeerConnection {
    const existing = peersRef.current.get(id);
    if (existing) return existing;

    addParticipant(id, name);

    const pc = new RTCPeerConnection(RTC_CONFIG);
    const local = streamRef.current;
    local?.getTracks().forEach((track) => pc.addTrack(track, local));

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        send({
          type: "ice-candidate",
          to: id,
          candidate: event.candidate.toJSON(),
        });
      }
    };

    pc.ontrack = (event) => {
      const stream = event.streams[0] || new MediaStream([event.track]);
      const peerName = namesRef.current.get(id) || name;

      registerMeter(id, stream);

      setRemoteAudio((old) => {
        if (old.some((item) => item.peerId === id)) {
          return old.map((item) =>
            item.peerId === id ? { ...item, stream, username: peerName } : item
          );
        }
        return [...old, { peerId: id, username: peerName, stream }];
      });
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "connected") {
        setStatus("Голосовое соединение активно");
      } else if (pc.connectionState === "failed") {
        setStatus("Не удалось соединиться. Возможно, нужен TURN-сервер.");
      }
    };

    peersRef.current.set(id, pc);
    return pc;
  }

  async function flushIce(id: string, pc: RTCPeerConnection) {
    const queue = pendingIceRef.current.get(id) || [];
    pendingIceRef.current.delete(id);

    for (const candidate of queue) {
      await pc.addIceCandidate(new RTCIceCandidate(candidate));
    }
  }

  async function startOffer(id: string, name: string) {
    if (offersRef.current.has(id)) return;
    offersRef.current.add(id);

    try {
      const pc = makePeer(id, name);
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      if (pc.localDescription) {
        send({ type: "offer", to: id, sdp: pc.localDescription });
      }
    } catch (e) {
      offersRef.current.delete(id);
      setError(errorMessage(e));
    }
  }

  async function handleSignal(msg: Signal) {
    if (msg.type === "hello") {
      peerIdRef.current = String(msg.peer_id || "");
      const existing = Array.isArray(msg.peers) ? msg.peers : [];

      for (const peer of existing) {
        const id = String(peer.peer_id || "");
        const name = peer.username || "Участник";
        addParticipant(id, name);

        if (peerIdRef.current && peerIdRef.current.localeCompare(id) < 0) {
          void startOffer(id, name);
        }
      }

      setStatus(existing.length ? "Подключение участников..." : "Ожидание игроков");
      return;
    }

    if (msg.type === "peer-joined") {
      const id = String(msg.peer_id || "");
      const name = msg.username || "Участник";
      addParticipant(id, name);

      if (peerIdRef.current && peerIdRef.current.localeCompare(id) < 0) {
        void startOffer(id, name);
      }
      return;
    }

    if (msg.type === "peer-left") {
      removeParticipant(String(msg.peer_id || ""));
      return;
    }

    const id = String(msg.from || "");
    if (!id) return;

    const name = msg.username || namesRef.current.get(id) || "Участник";
    addParticipant(id, name);

    if (msg.type === "offer" && msg.sdp) {
      const pc = makePeer(id, name);
      await pc.setRemoteDescription(new RTCSessionDescription(msg.sdp));
      await flushIce(id, pc);

      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      if (pc.localDescription) {
        send({ type: "answer", to: id, sdp: pc.localDescription });
      }
      return;
    }

    if (msg.type === "answer" && msg.sdp) {
      const pc = peersRef.current.get(id);
      if (!pc) return;
      await pc.setRemoteDescription(new RTCSessionDescription(msg.sdp));
      await flushIce(id, pc);
      return;
    }

    if (msg.type === "ice-candidate" && msg.candidate) {
      const pc = peersRef.current.get(id);

      if (!pc || !pc.remoteDescription) {
        const queue = pendingIceRef.current.get(id) || [];
        queue.push(msg.candidate);
        pendingIceRef.current.set(id, queue);
      } else {
        await pc.addIceCandidate(new RTCIceCandidate(msg.candidate));
      }
    }
  }

  async function joinVoice() {
    if (busy || joined) return;

    setBusy(true);
    setError("");

    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("Микрофон недоступен в этом контексте приложения.");
      }

      const token = localStorage.getItem("comind_access_token");
      if (!token) throw new Error("Сессия закончилась. Войди в COMIND снова.");

      const context = ensureAudioContext();
      await context.resume();

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: false,
      });

      streamRef.current = stream;
      registerMeter("self", stream);

      const response = await fetch(`${API}/api/voice/${channelId}/ticket`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
        },
      });

      const ticketData = await response.json().catch(() => ({}));
      if (!response.ok || !ticketData.ticket) {
        throw new Error(
          typeof ticketData.detail === "string"
            ? ticketData.detail
            : `Сервер не выдал билет голосового канала (HTTP ${response.status}).`
        );
      }

      const wsUrl = API.replace(/^http/i, "ws") +
        `/api/voice/ws?ticket=${encodeURIComponent(ticketData.ticket)}`;

      const socket = new WebSocket(wsUrl);
      socketRef.current = socket;

      socket.onmessage = (event) => {
        try {
          const message = JSON.parse(String(event.data)) as Signal;
          void handleSignal(message).catch((e) => setError(errorMessage(e)));
        } catch {
          setError("Сервер прислал некорректное сообщение.");
        }
      };

      socket.onclose = () => {
        if (socketRef.current === socket) {
          socketRef.current = null;
          peersRef.current.forEach((pc) => pc.close());
          peersRef.current.clear();
          streamRef.current?.getTracks().forEach((track) => track.stop());
          streamRef.current = null;
          stopAllMeters(true);
          setRemoteAudio([]);
          setParticipants([]);
          setJoined(false);
          setStatus("Сигнализация отключена");
        }
      };

      await new Promise<void>((resolve, reject) => {
        const timeout = window.setTimeout(() => {
          reject(new Error("Тайм-аут подключения к голосовому серверу."));
          socket.close();
        }, 10000);

        socket.onopen = () => {
          window.clearTimeout(timeout);
          resolve();
        };

        socket.onerror = () => {
          window.clearTimeout(timeout);
          reject(new Error("Не удалось открыть WebSocket. Проверь запуск backend."));
        };
      });

      setJoined(true);
      setStatus("Подключено; ожидаем участников");
    } catch (e) {
      socketRef.current?.close();
      socketRef.current = null;
      peersRef.current.forEach((pc) => pc.close());
      peersRef.current.clear();
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      stopAllMeters(true);
      setJoined(false);
      setStatus("Не подключено");
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  function leaveVoice() {
    const socket = socketRef.current;
    socketRef.current = null;

    if (socket) {
      if (socket.readyState === WebSocket.OPEN) {
        try { socket.send(JSON.stringify({ type: "leave" })); } catch { /* closing */ }
      }
      socket.close();
    }

    peersRef.current.forEach((pc) => pc.close());
    peersRef.current.clear();

    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;

    stopAllMeters(true);
    namesRef.current.clear();
    pendingIceRef.current.clear();
    offersRef.current.clear();
    peerIdRef.current = "";

    setRemoteAudio([]);
    setParticipants([]);
    setJoined(false);
    setMuted(false);
    setDeafened(false);
    setStatus("Не подключено");
  }

  function toggleMute() {
    const next = !muted;
    streamRef.current?.getAudioTracks().forEach((track) => {
      track.enabled = !next;
    });
    setMuted(next);
  }

  useEffect(() => {
    return () => {
      socketRef.current?.close();
      socketRef.current = null;

      peersRef.current.forEach((pc) => pc.close());
      peersRef.current.clear();

      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      stopAllMeters(true);
    };
  }, []);

  return (
    <div className="voice-room">
      <header className="voice-room-header">
        <div>
          <span className="voice-eyebrow">COMIND / WEBRTC</span>
          <h3>Голосовой канал: {channelName}</h3>
          <p>Участников: {participants.length + 1}</p>
        </div>
        <span className={`voice-status ${joined ? "is-live" : ""}`}>
          <i />{status}
        </span>
      </header>

      {error && <div className="voice-error" role="alert">{error}</div>}

      <div className="voice-participants">
        <div className={`voice-person self-person ${speakingIds.includes("self") ? "is-speaking" : ""}`}>
          <div className="voice-avatar">{username.slice(0, 1).toUpperCase()}</div>

          <div className="voice-person-copy">
            <strong>{username} (вы)</strong>
            <span>{joined ? (muted ? "Микрофон выключен" : "Микрофон включён") : "Не подключено"}</span>
          </div>

          <div className="voice-badges">
            {joined && (
              <span className={`voice-badge ${speakingIds.includes("self") && !muted ? "speaking" : muted ? "disabled" : "ready"}`}>
                {muted ? "МИКРОФОН ВЫКЛ" : speakingIds.includes("self") ? "ВЫ ГОВОРИТЕ" : "МИКРОФОН ВКЛ"}
              </span>
            )}
            {joined && deafened && (
              <span className="voice-badge disabled">ЗВУК ВЫКЛ</span>
            )}
          </div>
        </div>

        {participants.map((peer) => {
          const speaking = speakingIds.includes(peer.peer_id);
          const volume = volumes[peer.peer_id] ?? 100;

          return (
            <div
              className={`voice-person remote-person ${speaking ? "is-speaking" : ""}`}
              key={peer.peer_id}
            >
              <div className="voice-avatar remote-avatar">
                {peer.username.slice(0, 1).toUpperCase()}
              </div>

              <div className="voice-person-copy">
                <strong>{peer.username}</strong>
                <span>{speaking ? "Сейчас говорит" : "Голосовой участник"}</span>
              </div>

              <span className={`voice-badge ${speaking ? "speaking" : "ready"}`}>
                {speaking ? "ГОВОРИТ" : "В КОМНАТЕ"}
              </span>

              <div className="voice-volume">
                <label htmlFor={`volume-${peer.peer_id}`}>
                  <span>Громкость участника</span>
                  <strong>{volume}%</strong>
                </label>

                <input
                  id={`volume-${peer.peer_id}`}
                  aria-label={`Громкость участника ${peer.username}`}
                  type="range"
                  min="0"
                  max="100"
                  step="1"
                  value={volume}
                  onChange={(event) => setParticipantVolume(peer.peer_id, Number(event.target.value))}
                />
              </div>
            </div>
          );
        })}

        {joined && participants.length === 0 && (
          <div className="voice-empty">Ожидание других участников комнаты.</div>
        )}
      </div>

      <div className="voice-controls">
        {isPrivate && onInvite && (
          <button className="voice-button" type="button" onClick={onInvite}>
            {"\u041f\u0440\u0438\u0433\u043b\u0430\u0441\u0438\u0442\u044c \u0443\u0447\u0430\u0441\u0442\u043d\u0438\u043a\u0430"}
          </button>
        )}
        {!joined ? (
          <button className="voice-join" onClick={() => void joinVoice()} disabled={busy}>
            {busy ? "Подключение..." : "Подключиться к голосу"}
          </button>
        ) : (
          <>
            <button className={`voice-button ${muted ? "selected" : ""}`} onClick={toggleMute}>
              {muted ? "Включить микрофон" : "Выключить микрофон"}
            </button>

            <button
              className={`voice-button ${deafened ? "selected" : ""}`}
              onClick={() => setDeafened((value) => !value)}
            >
              {deafened ? "Включить звук" : "Выключить звук"}
            </button>

            <button className="voice-leave" onClick={leaveVoice}>Отключиться</button>
          </>
        )}
      </div>

      <div className="voice-audio-hidden">
        {remoteAudio.map((item) => (
          <audio
            key={item.peerId}
            autoPlay
            playsInline
            muted={deafened}
            ref={(element) => {
              if (!element) {
                audioElementsRef.current.delete(item.peerId);
                return;
              }

              audioElementsRef.current.set(item.peerId, element);
              element.volume = (volumes[item.peerId] ?? 100) / 100;

              if (element.srcObject !== item.stream) {
                element.srcObject = item.stream;
                void element.play().catch(() => {
                  setError("Не удалось воспроизвести звук. Проверь настройки вывода аудио.");
                });
              }
            }}
          />
        ))}
      </div>
    </div>
  );
}