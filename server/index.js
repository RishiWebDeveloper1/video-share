import express from "express";
import http from "http";
import { Server } from "socket.io";

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "https://video-share-brown.vercel.app",
    methods: ["GET", "POST"]
  }
});

io.on("connection", socket => {
  console.log("Client connected:", socket.id);

  socket.on("join-room", (roomId, cb) => {
    const room = io.sockets.adapter.rooms.get(roomId);
    const initiator = !room || room.size === 0;

    socket.join(roomId);
    cb?.({ initiator });

    socket.to(roomId).emit("peer-joined");
  });

  socket.on("signal", ({ roomId, data }) => {
    socket.to(roomId).emit("signal", data);
  });

  socket.on("disconnecting", () => {
    for (const roomId of socket.rooms) {
      if (roomId !== socket.id) {
        socket.to(roomId).emit("peer-left");
      }
    }
  });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, "0.0.0.0", () => {
  console.log("Socket.IO server running on port", PORT);
});
