const { Server } = require("socket.io");

const PORT = process.env.PORT || 3001;
const io = new Server(PORT, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

console.log(`[Worker] Telemetry Socket engine running on port ${PORT}`);

const activeNodes = new Map();

io.on("connection", (socket) => {
  console.log(`[Worker] Client connected: ${socket.id}`);

  socket.on("register-node", (profile) => {
    activeNodes.set(socket.id, {
      id: socket.id,
      role: profile.role || "student",
      label: profile.label || "Generic Node",
      position: null
    });
  });

  socket.on("push-telemetry", (metrics) => {
    const node = activeNodes.get(socket.id);
    if (node) {
      node.position = {
        lat: metrics.latitude,
        lng: metrics.longitude,
        bearing: metrics.heading || 0
      };
      io.emit("node-updated", node);
    }
  });

  socket.on("disconnect", () => {
    if (activeNodes.has(socket.id)) {
      activeNodes.delete(socket.id);
      io.emit("node-dropped", socket.id);
      console.log(`[Worker] Client dropped: ${socket.id}`);
    }
  });
});
