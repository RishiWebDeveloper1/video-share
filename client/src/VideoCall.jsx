import { useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";

export default function VideoCall({ roomId }) {
    /* ================= REFS ================= */
    const isInitiator = useRef(false);

    const localVideo = useRef(null);
    const remoteVideo = useRef(null);
    const pc = useRef(null);
    const socket = useRef(null);

    const cameraStream = useRef(null);
    const screenStream = useRef(null);
    const pendingCandidates = useRef([]);

    /* ================= STATE ================= */
    const [status, setStatus] = useState("Initializing...");
    const [isScreenSharing, setIsScreenSharing] = useState(false);
    const [isFullscreen, setIsFullscreen] = useState(false);

    /* ================= LOG HELPERS ================= */
    const log = (...args) => console.log("[VideoCall]", ...args);
    const error = (...args) => console.error("[VideoCall ERROR]", ...args);

    // ====================================
    const resetAndRecreatePeer = () => {
        log("Resetting peer connection (hard reset)");

        closePeer();

        if (cameraStream.current) {
            createPeer(cameraStream.current);
        }
    };


    /* ================= INIT ================= */
    useEffect(() => {
        if (!navigator.mediaDevices?.getUserMedia) {
            alert("Camera not supported");
            return;
        }

        log("Connecting socket...");
        socket.current = io("https://video-share-bg1r.onrender.com", {
            transports: ["polling"],
            withCredentials: true
        });

        socket.current.on("connect", () => {
            log("Socket connected:", socket.current.id);
            socket.current.emit("join-room", roomId, ack => {
                // ack = { initiator: true/false }
                isInitiator.current = ack?.initiator ?? false;
                log("Initiator:", isInitiator.current);
            });

        });

        socket.current.on("peer-joined", () => {
            log("Peer joined → creating offer");

            resetAndRecreatePeer();
            safeCreateOffer();
        });

        socket.current.on("signal", data => {
            log("Signal received:", data);
            handleSignal(data);
        });

        socket.current.on("disconnect", reason => {
            log("Socket disconnected:", reason);
        });

        startCamera();

        return () => {
            log("Cleanup on unmount");
            socket.current?.disconnect();
            closePeer();
        };
    }, []);

    /* ================= PEER ================= */
    const createPeer = stream => {
        if (pc.current) return;

        log("Creating RTCPeerConnection");
        pc.current = new RTCPeerConnection({
            iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
        });

        stream.getTracks().forEach(track =>
            pc.current.addTrack(track, stream)
        );

        pc.current.ontrack = e => {
            log("Remote track received");
            remoteVideo.current.srcObject = e.streams[0];
        };

        pc.current.onicecandidate = e => {
            if (e.candidate) {
                log("Sending ICE candidate");
                socket.current.emit("signal", {
                    roomId,
                    data: { candidate: e.candidate }
                });
            }
        };

        pc.current.oniceconnectionstatechange = () => {
            log("ICE state:", pc.current.iceConnectionState);

            if (
                pc.current.iceConnectionState === "disconnected" ||
                pc.current.iceConnectionState === "failed"
            ) {
                log("ICE failed → resetting peer");
                resetAndRecreatePeer();
            }
        };

    };

    const closePeer = () => {
        if (pc.current) {
            log("Closing peer connection");
            pc.current.close();
            pc.current = null;
        }
        pendingCandidates.current = [];
    };

    /* ================= CAMERA ================= */
    const startCamera = async () => {
        try {
            log("Starting camera");
            cameraStream.current = await navigator.mediaDevices.getUserMedia({
                video: true,
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true
                }
            });

            localVideo.current.srcObject = cameraStream.current;
            createPeer(cameraStream.current);

            setStatus("Waiting for peer...");
        } catch (err) {
            error("Camera error", err);
            alert("Camera permission denied");
        }
    };

    /* ================= SCREEN SHARE ================= */
    const toggleScreenShare = async () => {
        try {
            if (!isScreenSharing) {
                log("Starting screen share");
                screenStream.current =
                    await navigator.mediaDevices.getDisplayMedia({
                        video: true,
                        audio: false
                    });

                const screenTrack = screenStream.current.getVideoTracks()[0];
                replaceVideoTrack(screenTrack);
                localVideo.current.srcObject = screenStream.current;
                setIsScreenSharing(true);

                screenTrack.onended = stopScreenShare;
            } else {
                stopScreenShare();
            }
        } catch (err) {
            error("Screen share error", err);
        }
    };

    const stopScreenShare = () => {
        log("Stopping screen share");
        if (!cameraStream.current) return;

        const camTrack = cameraStream.current.getVideoTracks()[0];
        replaceVideoTrack(camTrack);
        localVideo.current.srcObject = cameraStream.current;

        screenStream.current?.getTracks().forEach(t => t.stop());
        screenStream.current = null;
        setIsScreenSharing(false);
    };

    const replaceVideoTrack = newTrack => {
        const sender = pc.current
            ?.getSenders()
            .find(s => s.track?.kind === "video");

        if (!sender) {
            error("No video sender found");
            return;
        }

        sender.replaceTrack(newTrack);
    };

    /* ================= SIGNALING ================= */
    const safeCreateOffer = async () => {
        if (!pc.current) {
            log("PC missing → recreating");
            createPeer(cameraStream.current);
        }

        try {
            const offer = await pc.current.createOffer();
            await pc.current.setLocalDescription(offer);

            socket.current.emit("signal", {
                roomId,
                data: { offer }
            });

            log("Offer sent");
        } catch (err) {
            error("Offer error", err);
        }
    };

    const handleSignal = async data => {
        try {
            if (!pc.current) {
                log("PC not ready → ignoring signal");
                return;
            }

            if (data.offer) {
                log("Handling offer");
                await pc.current.setRemoteDescription(data.offer);
                flushCandidates();

                const answer = await pc.current.createAnswer();
                await pc.current.setLocalDescription(answer);

                socket.current.emit("signal", {
                    roomId,
                    data: { answer }
                });

                setStatus("Connected");
            }

            if (data.answer) {
                if (!pc.current) return;

                // 🔒 CRITICAL STATE CHECK
                if (pc.current.signalingState !== "have-local-offer") {
                    console.warn(
                        "[VideoCall] Ignoring answer in state:",
                        pc.current.signalingState
                    );
                    return;
                }

                await pc.current.setRemoteDescription(data.answer);
                setStatus("Connected");
            }

            if (data.candidate) {
                if (pc.current.remoteDescription) {
                    await pc.current.addIceCandidate(data.candidate);
                } else {
                    log("Queueing ICE candidate");
                    pendingCandidates.current.push(data.candidate);
                }
            }
        } catch (err) {
            error("Signal handling failed", err, data);
        }
    };

    const flushCandidates = () => {
        log("Flushing ICE candidates:", pendingCandidates.current.length);
        pendingCandidates.current.forEach(c =>
            pc.current.addIceCandidate(c)
        );
        pendingCandidates.current = [];
    };

    /* ================= FULLSCREEN ================= */
    const toggleFullscreen = () => {
        const el = document.querySelector(".video-call");
        if (!el) return;

        if (!document.fullscreenElement) {
            el.requestFullscreen?.();
        } else {
            document.exitFullscreen?.();
        }
    };

    useEffect(() => {
        const sync = () => setIsFullscreen(!!document.fullscreenElement);
        document.addEventListener("fullscreenchange", sync);
        return () => document.removeEventListener("fullscreenchange", sync);
    }, []);

    useEffect(() => {
        const showMessage = () => {
            let message = { icon: "check", text: status }
            const screen = document.querySelector('.video-call');
            let messageCard = document.createElement("div");
            messageCard.classList.add("message-container");

            // <div class="message-container">
            const messageBody = `
                <div class="message-body">
                    <div class="message-logo-box">
                        ${message.icon == "check" ?
                    `<div class="message-circle">
                                <div class="message-small-line"></div>
                                <div class="message-big-line"></div>
                            </div>`
                    : message.icon == 'warn' ?
                        `<div class="message-circle-warn">
                                <div class="message-main-line"></div>
                                <div class="message-dot"></div>
                            </div>`
                        :
                        `<div class="message-circle-wrong">
                                <div class="message-1-line"></div>
                                <div class="message-2-line"></div>
                            </div>`
                }
                    </div>
                    <div class="message-text-box">${message.text.split(":")[0]}</div>
                    <div class="message-detail-box">${message.text.split(":")[1]}</div>
                    <div class="message-ok-button">OK</div>
                </div>
                `
            // </div>

            messageCard.innerHTML = messageBody;
            screen.appendChild(messageCard);

            setTimeout(() => {
                // try {
                messageCard.remove();
                // } catch (err) {
                //     console.log(err);
                // }
            }, 2000);
        }
        showMessage()
    }, [status])

    const [key, setKey] = useState(0);

    const softReload = () => {
        setKey(k => k + 1);
    };

    /* ================= UI ================= */
    return (
        <div className="video-call">
            <video className={`video-self ${isScreenSharing ? "screen" : ""}`} ref={localVideo} autoPlay muted playsInline />
            <video className="video-other" ref={remoteVideo} autoPlay playsInline />

            <div className="call-controls">
                <button className="call-btn" onClick={toggleFullscreen}>{isFullscreen ? "🗗" : "🗖"}</button>
                <button className="call-btn" onClick={() => { setStatus("s") }}>🎤</button>
                <button className="call-btn">📷</button>
                <button className="call-btn" onClick={toggleScreenShare}>{isScreenSharing ? "🛑" : "🖥️"}</button>
                <button className="call-btn end" onClick={softReload}>📞</button>
            </div>
        </div>
    );
}
