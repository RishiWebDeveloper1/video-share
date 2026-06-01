import { useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";
import { Headphones, Mic, MicOff, Phone, Users, Volume2 } from "lucide-react";

export default function AudioCall({ roomId }) {
    const isInitiator = useRef(false);
    const roomFull = useRef(false);
    const socket = useRef(null);
    const pc = useRef(null);
    const localStream = useRef(null);
    const remoteAudio = useRef(null);
    const pendingCandidates = useRef([]);
    const pendingSignals = useRef([]);
    const peerJoined = useRef(false);
    const callStartTime = useRef(null);

    const [status, setStatus] = useState("Initializing...");
    const [isMuted, setIsMuted] = useState(false);
    const [connectCountdown, setConnectCountdown] = useState(0);
    const [callDurationSec, setCallDurationSec] = useState(0);
    const [deviceOptions, setDeviceOptions] = useState({ inputs: [], outputs: [] });
    const [selectedMicId, setSelectedMicId] = useState("");
    const [selectedSpeakerId, setSelectedSpeakerId] = useState("");

    const log = (...args) => console.log("[AudioCall]", ...args);
    const error = (...args) => console.error("[AudioCall ERROR]", ...args);

    const peerName = "Guest";
    const isConnected = status === "Connected";
    const isRoomBlocked = status === "Room is full";

    const formatDuration = totalSec => {
        const minutes = Math.floor(totalSec / 60)
            .toString()
            .padStart(2, "0");
        const seconds = Math.floor(totalSec % 60)
            .toString()
            .padStart(2, "0");

        return `${minutes}:${seconds}`;
    };

    const refreshDeviceOptions = async () => {
        if (!navigator.mediaDevices?.enumerateDevices) return;

        const devices = await navigator.mediaDevices.enumerateDevices();
        const inputs = devices.filter(device => device.kind === "audioinput" && (device.deviceId !== "default"));
        const outputs = devices.filter(device => device.kind === "audiooutput");

        setDeviceOptions({ inputs, outputs });
        setSelectedMicId(current => current || inputs[0]?.deviceId || "");
        setSelectedSpeakerId(current => current || outputs[0]?.deviceId || "");
    };

    const applySpeakerOutput = async deviceId => {
        if (!remoteAudio.current?.setSinkId || !deviceId) return;

        try {
            await remoteAudio.current.setSinkId(deviceId);
        } catch (err) {
            error("Speaker device change failed", err);
        }
    };

    const getSelectedMicDevice = () =>
        deviceOptions.inputs.find(device => device.deviceId === selectedMicId);

    const getNextMicDeviceId = () => {
        const nextDevice = deviceOptions.inputs.find(device => device.deviceId !== selectedMicId);
        return nextDevice?.deviceId || selectedMicId || "";
    };

    const isSpeakerphoneMic = () => getSelectedMicDevice()?.label === "Speakerphone";

    const switchMicrophone = async nextMicId => {
        if (!nextMicId) return;

        setSelectedMicId(nextMicId);

        try {
            const nextTrack = await startAudioStream(nextMicId);
            replaceAudioTrack(nextTrack);
            setIsMuted(false);
            nextTrack.enabled = true;
        } catch (err) {
            error("Microphone switch failed", err);
        }
    };

    const replaceAudioTrack = newTrack => {
        const sender = pc.current
            ?.getSenders()
            .find(item => item.track?.kind === "audio");

        sender?.replaceTrack(newTrack);
    };

    const startAudioStream = async deviceId => {
        const stream = await navigator.mediaDevices.getUserMedia({
            audio: {
                deviceId: deviceId ? { exact: deviceId } : undefined,
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true
            },
            video: false
        });

        const nextTrack = stream.getAudioTracks()[0];
        const previousTrack = localStream.current?.getAudioTracks()[0];

        if (previousTrack && previousTrack !== nextTrack) {
            previousTrack.stop();
        }

        localStream.current = stream;
        createPeer(stream);
        await refreshDeviceOptions();
        await applySpeakerOutput(selectedSpeakerId);
        return nextTrack;
    };

    const handleMicChange = async event => {
        await switchMicrophone(event.target.value);
    };

    const handleSpeakerChange = async event => {
        const nextSpeakerId = event.target.value;
        setSelectedSpeakerId(nextSpeakerId);
        await applySpeakerOutput(nextSpeakerId);
    };

    const closePeer = () => {
        if (pc.current) {
            log("Closing peer connection");
            pc.current.close();
            pc.current = null;
        }

        pendingCandidates.current = [];
    };

    const flushCandidates = () => {
        if (!pc.current) return;

        pendingCandidates.current.forEach(candidate => {
            pc.current.addIceCandidate(candidate);
        });

        pendingCandidates.current = [];
    };

    const applySignal = async data => {
        if (data.offer) {
            await pc.current.setRemoteDescription(data.offer);
            flushCandidates();

            const answer = await pc.current.createAnswer();
            await pc.current.setLocalDescription(answer);

            socket.current?.emit("signal", {
                roomId,
                data: { answer }
            });

            setStatus("Connected");
        }

        if (data.answer) {
            if (pc.current.signalingState !== "have-local-offer") {
                return;
            }

            await pc.current.setRemoteDescription(data.answer);
            setStatus("Connected");
        }

        if (data.candidate) {
            if (pc.current.remoteDescription) {
                await pc.current.addIceCandidate(data.candidate);
            } else {
                pendingCandidates.current.push(data.candidate);
            }
        }
    };

    const flushPendingSignals = async () => {
        if (!pc.current || pendingSignals.current.length === 0) return;

        const queuedSignals = [...pendingSignals.current];
        pendingSignals.current = [];

        for (const signal of queuedSignals) {
            await applySignal(signal);
        }
    };

    const createPeer = stream => {
        if (pc.current || !stream) return;

        log("Creating RTCPeerConnection");
        pc.current = new RTCPeerConnection({
            iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
        });

        stream.getAudioTracks().forEach(track => {
            pc.current.addTrack(track, stream);
        });

        pc.current.ontrack = event => {
            log("Remote audio track received");
            if (remoteAudio.current) {
                remoteAudio.current.srcObject = event.streams[0];
                remoteAudio.current.play?.().catch(() => { });
            }
            setStatus("Connected");
        };

        pc.current.onicecandidate = event => {
            if (!event.candidate) return;

            socket.current?.emit("signal", {
                roomId,
                data: { candidate: event.candidate }
            });
        };

        pc.current.oniceconnectionstatechange = () => {
            if (!pc.current) return;

            log("ICE state:", pc.current.iceConnectionState);
            if (
                pc.current.iceConnectionState === "disconnected" ||
                pc.current.iceConnectionState === "failed"
            ) {
                log("ICE failed -> resetting peer");
                resetAndRecreatePeer();
            }
        };

        flushPendingSignals();
    };

    const safeCreateOffer = async () => {
        if (!pc.current && localStream.current) {
            createPeer(localStream.current);
        }

        if (!pc.current) return;

        try {
            const offer = await pc.current.createOffer();
            await pc.current.setLocalDescription(offer);

            socket.current?.emit("signal", {
                roomId,
                data: { offer }
            });

            setStatus("Waiting for peer...");
        } catch (err) {
            error("Offer error", err);
        }
    };

    const resetAndRecreatePeer = () => {
        closePeer();

        if (localStream.current) {
            createPeer(localStream.current);
            flushPendingSignals();

            if (peerJoined.current) {
                safeCreateOffer();
            }
        }
    };

    const handleSignal = async data => {
        try {
            if (!pc.current) {
                pendingSignals.current.push(data);
                return;
            }

            await applySignal(data);
        } catch (err) {
            error("Signal handling failed", err, data);
            setStatus("Connection error");
        }
    };

    const toggleMic = () => {
        const audioTrack = localStream.current?.getAudioTracks()[0];

        if (!audioTrack) return;

        audioTrack.enabled = !audioTrack.enabled;
        setIsMuted(!audioTrack.enabled);
    };

    useEffect(() => {
        if (isConnected || isRoomBlocked || status.includes("failed")) {
            setConnectCountdown(0);
            return;
        }

        if (!localStream.current) {
            setConnectCountdown(0);
            return;
        }

        setConnectCountdown(3);
        const timer = setInterval(() => {
            setConnectCountdown(current => {
                if (current <= 1) {
                    clearInterval(timer);
                    return 0;
                }

                return current - 1;
            });
        }, 1000);

        return () => clearInterval(timer);
    }, [isConnected, isRoomBlocked, status]);

    useEffect(() => {
        if (!isConnected) {
            callStartTime.current = null;
            setCallDurationSec(0);
            return;
        }

        if (!callStartTime.current) {
            callStartTime.current = Date.now();
        }

        const timer = setInterval(() => {
            const elapsed = Math.floor((Date.now() - callStartTime.current) / 1000);
            setCallDurationSec(elapsed);
        }, 1000);

        return () => clearInterval(timer);
    }, [isConnected]);

    useEffect(() => {
        const syncDevices = () => refreshDeviceOptions().catch(() => { });

        syncDevices();
        navigator.mediaDevices?.addEventListener?.("devicechange", syncDevices);
        return () => navigator.mediaDevices?.removeEventListener?.("devicechange", syncDevices);
    }, []);

    useEffect(() => {
        if (!navigator.mediaDevices?.getUserMedia) {
            alert("Microphone not supported");
            return;
        }

        socket.current = io(`${import.meta.env.VITE_BASE_URL}`, {
            transports: ["websocket", "polling"],
            withCredentials: true
        });

        socket.current.on("connect", () => {
            socket.current.emit("join-room", roomId, ack => {
                roomFull.current = ack?.full ?? false;

                if (roomFull.current) {
                    setStatus("Room is full");
                    return;
                }

                isInitiator.current = ack?.initiator ?? false;
                log("Initiator:", isInitiator.current);
            });
        });

        socket.current.on("peer-joined", () => {
            peerJoined.current = true;

            if (localStream.current) {
                resetAndRecreatePeer();
                safeCreateOffer();
            }
        });

        socket.current.on("signal", data => {
            handleSignal(data);
        });

        socket.current.on("disconnect", reason => {
            log("Socket disconnected:", reason);
        });

        const startAudio = async () => {
            try {
                if (roomFull.current) return;

                const nextTrack = await startAudioStream(selectedMicId);
                nextTrack.enabled = true;
                setIsMuted(false);
                flushPendingSignals();
                await applySpeakerOutput(selectedSpeakerId);

                if (!roomFull.current && (peerJoined.current || isInitiator.current)) {
                    safeCreateOffer();
                }
            } catch (err) {
                error("Microphone error", err);
                setStatus("Microphone access failed");
            }
        };

        startAudio();

        return () => {
            socket.current?.disconnect();
            localStream.current?.getTracks().forEach(track => track.stop());
            closePeer();
        };
    }, [roomId]);

    return (
        <div className="audio-call">
            <div className="call-top-status">
                <div>{status === "Connected" ? "In Call" : status}</div>
                <div>{`Other user: ${peerName}`}</div>
                <div>{isConnected ? `Call • ${formatDuration(callDurationSec)}` : connectCountdown > 0 ? `Connecting • 00:0${connectCountdown}` : `Room ${roomId}`}</div>
            </div>

            <div className="circle-user-box">
                <span class="ripple r1"></span>
                <span class="ripple r2"></span>
                <span class="ripple r3"></span>
                <span class="ripple r4"></span>

                <div className="circle-user">
                    User
                </div>
            </div>
            <audio ref={remoteAudio} autoPlay playsInline />

            <div className="call-controls">
                <button className="call-btn" onClick={toggleMic}>{isMuted ? <MicOff /> : <Mic />}</button>
                <button className="call-btn" onClick={() => switchMicrophone(getNextMicDeviceId())}>{isSpeakerphoneMic() ? <Volume2 /> : <Headphones />}</button>
                <button className="call-btn end" onClick={() => window.close()}><Phone /></button>
            </div>
        </div>
    );
}
