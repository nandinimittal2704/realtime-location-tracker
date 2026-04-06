require("dotenv").config();

const express = require("express");
const session = require("express-session");
const passport = require("./config/passport");
const http = require("http");
const socketIo = require("socket.io");
const connectDB = require("./config/db");

const app = express();
app.set('trust proxy', 1);
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
  },
});

// In-memory storage
const connectedDevices = new Map();
const peers = new Map();

// Setup imports
const setupMiddleware = require("./middleware/middleware");
const setupRoutes = require("./routes/routes");
const setupSockets = require("./sockets/sockets");


//  AUTH + SESSION SETUP

app.use(
  session({
    secret: process.env.SESSION_SECRET || "secret123",
    resave: false,
    saveUninitialized: true,
  })
);

app.use(passport.initialize());
app.use(passport.session());


//  BASIC MIDDLEWARE

setupMiddleware(app);


//  HOME ROUTE (LOGIN PAGE)

app.get("/", (req, res) => {
  if (req.isAuthenticated()) {
    return res.redirect("/dashboard");
  }
  res.render("login");
});


//  GOOGLE AUTH ROUTES
app.get(
  "/auth/google",
  passport.authenticate("google", { scope: ["profile", "email"] })
);

app.get(
  "/auth/google/callback",
  passport.authenticate("google", {
    failureRedirect: "/",
  }),
  (req, res) => {
    res.redirect("/dashboard");
  }
);


//  PROTECTED ROUTE
function isLoggedIn(req, res, next) {
  if (req.isAuthenticated()) return next();
  res.redirect("/");
}

app.get("/dashboard", isLoggedIn, (req, res) => {
  res.render("index", { user: req.user });
});

//  LOGOUT
app.get("/logout", (req, res) => {
  req.logout(() => {
    res.redirect("/");
  });
});

//  OTHER ROUTES + SOCKETS
setupRoutes(app);
setupSockets(io, connectedDevices, peers);

//  ERROR HANDLING
app.use((err, req, res, next) => {
  console.error("Server error:", err.stack);
  res.status(500).send("Something went wrong!");
});

// START SERVER
const PORT = process.env.PORT || 3007;

connectDB();

server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});