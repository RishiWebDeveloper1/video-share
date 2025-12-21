import fs from "fs";
import https from "https";
import express from "express";
import { Server } from "socket.io";

const app = express();

const httpsServer = https.createServer(
  {
    key: fs.readFileSync("./cert/key.pem"),
    cert: fs.readFileSync("./cert/cert.pem")
  },
  app
);

const io = new Server(httpsServer, {
  cors: { origin: "*" }
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


httpsServer.listen(5000, "0.0.0.0", () => {
  console.log("HTTPS signaling server running on 5000");
});
