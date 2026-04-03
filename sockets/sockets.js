const sanitizeHtml = require('sanitize-html');
const Location = require("../models/Location");

// ========================
// 🔍 GET CLIENT IP
// ========================
function getClientIP(socket) {
    const handshake = socket.handshake;

    const forwardedFor = handshake.headers['x-forwarded-for'];
    if (forwardedFor) {
        return forwardedFor.split(',')[0].trim();
    }

    const realIP = handshake.headers['x-real-ip'];
    if (realIP) return realIP;

    const cfIP = handshake.headers['cf-connecting-ip'];
    if (cfIP) return cfIP;

    let address = handshake.address;
    if (address && address.startsWith('::ffff:')) {
        address = address.substring(7);
    }

    return address || 'Unknown';
}

// ========================
// 📊 DEVICES IN ROOM
// ========================
function getDevicesInRoom(connectedDevices, room) {
    return Array.from(connectedDevices.entries())
        .filter(([_, data]) => data.room === room);
}

// ========================
// 🚀 SOCKET SETUP
// ========================
module.exports = function setupSockets(io, connectedDevices, peers) {

    io.on('connection', (socket) => {

        const clientIP = getClientIP(socket);
        socket.clientIP = clientIP;
        socket.room = 'public';

        console.log(`User connected: ${socket.id} (IP: ${clientIP})`);

        // ========================
        // 🏠 JOIN ROOM
        // ========================
        socket.on('join-room', (data) => {
            const roomName = data?.room ? sanitizeHtml(data.room) : 'public';
            const deviceName = data?.deviceName ? sanitizeHtml(data.deviceName) : 'Unknown';

            socket.join(roomName);
            socket.room = roomName;
            socket.deviceName = deviceName;

            socket.emit('joined-room', { room: roomName });

            const devicesInRoom = getDevicesInRoom(connectedDevices, roomName);
            socket.emit('update-device-list', devicesInRoom);
            io.to(roomName).emit('update-user-count', devicesInRoom.length);
        });

        // ========================
        // 📍 LOCATION TRACKING + DB SAVE
        // ========================
        socket.on('send-location', async (data) => {

            if (!data || !data.latitude || !data.longitude || !data.deviceName) {
                console.warn(`Invalid location data from ${socket.id}`);
                return;
            }

            if (!socket.room) {
                socket.join('public');
                socket.room = 'public';
            }

            const sanitizedDeviceName = sanitizeHtml(data.deviceName, {
                allowedTags: [],
                allowedAttributes: {}
            });

            const deviceData = {
                latitude: data.latitude,
                longitude: data.longitude,
                deviceName: sanitizedDeviceName,
                accuracy: data.accuracy,
                deviceInfo: data.deviceInfo || {},
                ip: socket.clientIP,
                joinedAt: new Date(),
                room: socket.room
            };

            // 🔥 SAVE TO MONGODB
            try {
                await Location.create({
                    userId: socket.id,
                    lat: data.latitude,
                    lng: data.longitude
                });
            } catch (err) {
                console.error("❌ MongoDB Save Error:", err);
            }

            connectedDevices.set(socket.id, deviceData);

            // Emit to room
            io.to(socket.room).emit('receive-location', {
                id: socket.id,
                ...deviceData
            });

            const devicesInRoom = getDevicesInRoom(connectedDevices, socket.room);
            io.to(socket.room).emit('update-device-list', devicesInRoom);
            io.to(socket.room).emit('update-user-count', devicesInRoom.length);
        });

        // ========================
        // 🔍 FOCUS DEVICE
        // ========================
        socket.on('request-device-location', (id) => {
            const device = connectedDevices.get(id);

            if (device && device.room === socket.room) {
                socket.emit('focus-device-location', { id, ...device });
            }
        });

        // ========================
        // 💬 CHAT
        // ========================
        socket.on('chat-message', (data, callback) => {

            if (!data?.text || !socket.deviceName) {
                return callback?.({ error: 'Invalid message' });
            }

            const room = socket.room || 'public';

            const messageData = {
                id: Date.now(),
                text: sanitizeHtml(data.text),
                sender: socket.deviceName,
                senderId: socket.id,
                timestamp: Date.now(),
                room
            };

            io.to(room).emit('chat-message', messageData);

            callback?.({ success: true });
        });

        // ========================
        // 🆘 SOS ALERT
        // ========================
        socket.on('sos-alert', (data) => {

            if (!data?.location || !data?.sender) return;

            const room = socket.room || 'public';

            const sosData = {
                id: `sos-${Date.now()}-${socket.id}`,
                sender: sanitizeHtml(data.sender),
                senderId: socket.id,
                location: data.location,
                timestamp: Date.now(),
                room
            };

            socket.to(room).emit('sos-alert', sosData);
        });

        // ========================
        // 🔊 AUDIO
        // ========================
        socket.on('join-audio', () => {

            const room = socket.room || 'public';

            const currentPeers = Array.from(peers.entries())
                .filter(([id, p]) => id !== socket.id && p.room === room)
                .map(([id, p]) => ({
                    peerId: id,
                    userName: p.deviceName
                }));

            peers.set(socket.id, {
                socket,
                deviceName: socket.deviceName,
                room
            });

            socket.emit('audio-peers', currentPeers);

            socket.to(room).emit('user-connected', {
                peerId: socket.id,
                userName: socket.deviceName
            });
        });

        socket.on('leave-audio', () => {
            const room = socket.room || 'public';
            peers.delete(socket.id);

            socket.to(room).emit('user-disconnected', {
                peerId: socket.id,
                userName: socket.deviceName
            });
        });

        // ========================
        // ❌ DISCONNECT
        // ========================
        socket.on('disconnect', () => {

            const room = socket.room || 'public';
            const deviceData = connectedDevices.get(socket.id);

            if (deviceData) {
                io.to(room).emit('user-disconnect', {
                    peerId: socket.id,
                    userName: deviceData.deviceName
                });
            }

            connectedDevices.delete(socket.id);
            peers.delete(socket.id);

            const devicesInRoom = getDevicesInRoom(connectedDevices, room);
            io.to(room).emit('update-device-list', devicesInRoom);
            io.to(room).emit('update-user-count', devicesInRoom.length);

            console.log(`User disconnected: ${socket.id}`);
        });
    });
};