import dotenv from "dotenv";
import express from "express";
import http from "http";
import { Server } from "socket.io";

dotenv.config()
const app = express();

app.get("/", (req, res) => {
  res.send("OK");
});

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: `${process.env.BASE_URL}`,
    methods: ["GET", "POST"],
    credentials: true
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
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, "0.0.0.0", () => {
  console.log("Server listening on port", PORT);
});
