import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'

const makeRoomId = () => Math.random().toString(36).slice(2, 8).toUpperCase()

const Home = () => {
    const [room, setRoom] = useState("")
    const [name, setName] = useState("")
    const navigate = useNavigate()

    const join = () => {
        const roomId = room.trim() || makeRoomId()
        navigate(`/call/audio/${roomId}`)
    }

    return (
        <main className="home-container">
            <div className="home-card">
                <h2>Join an audio room</h2>
                <p className="muted">Enter a room ID or generate one.</p>

                <label className="label">Your name (optional)</label>
                <input
                    className="room-input"
                    placeholder="e.g. Alex"
                    value={name}
                    onChange={e => setName(e.target.value)}
                />

                <label className="label">Room ID</label>
                <input
                    className="room-input"
                    placeholder="Leave blank to create a new room"
                    value={room}
                    onChange={e => setRoom(e.target.value)}
                />

                <div className="home-actions">
                    <button className="btn btn-primary" onClick={join}>Join audio room</button>
                    <button className="btn btn-secondary" onClick={() => setRoom(makeRoomId())}>Generate</button>
                </div>

                <p className="hint">Tip: share the Room ID with the other participant.</p>
            </div>
        </main>
    )
}

export default Home
