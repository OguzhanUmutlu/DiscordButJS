// noinspection JSUnusedLocalSymbols,JSUnusedGlobalSymbols

const express = require("express");
const Database = require("./src/Database");
const db = new Database("data.json");
const htmlNode = require("html-node-compiler");
const passport = require("./src/Passport");
const fs = require("fs");
const {Session, createSession, removeSession} = passport;
const ChatAPI = require("./src/ChatAPI");
const {
    Channel,
    Message,
    User,
    getDM,
    createChannel,
    createDM,
    getChannel,
    setDatabase,
    getLoginUser,
    getUser,
    Packet,
    PACKETS
} = ChatAPI;
setDatabase(db);

db.get("id", 11111);

let app = express();
htmlNode.setShowErrorToClient(false);
htmlNode.setDirectory("./web/");
app.use(htmlNode.callback);
app.use(require("body-parser").urlencoded({extended: true}));
app.use(passport.callback);
app.use((a, b, c) => {
    b.alt = (m, t = "") => b.send(`<script>alert("${m}");window.location.href="/${t}";</script>`);
    c();
});

module.exports.allowedDomains = [
    ".png", ".jpg", ".jpeg", ".gif"
];

const WebSocket = require("ws");
const wss = new WebSocket.Server({port: 7071});
const clients = {};
let idL = 0;

module.exports.clients = () => clients;

class Client {
    /**
     * @param {number} id
     * @param {WebSocket} ws
     */
    constructor(id, ws) {
        this.id = id;
        this.ws = ws;
    }

    setToken(token) {
        this.token = token;
        return this;
    }

    setUserId(userId) {
        this.userId = userId;
        return this;
    }

    getUser() {
        return ChatAPI.getUser(this.userId);
    }

    setChannelId(channelId) {
        this.channelId = channelId;
        return this;
    }

    /**
     * @returns {Channel|null}
     */
    getChannel() {
        return ChatAPI.getChannel(this.channelId);
    }
}

wss.on('connection', (ws) => {
    ws.sendPacket = m => ws.send(JSON.stringify(m));
    const client = new Client(idL++, ws);
    clients[client.id] = client;
    ws.on("message", json => {
        try {
            json = JSON.parse(json);
            switch (json.action) {
                case "LOGIN":
                    if (client.token || !json.token) return;
                    let user;
                    if (!(user = ChatAPI.getUser((passport.getSession(json.token) || {}).id))) return;
                    client.setToken(json.token);
                    client.setUserId(user.id);
                    break;
                case "FETCH_CHANNEL":
                    const channel = ChatAPI.getChannel(json.channelId);
                    if (!channel) return;
                    client.channelId = json.channelId;
                    const messages = channel.getMessages();
                    messages.forEach((i, k) => {
                        if (i.deleted) {
                            messages[k].content = null;
                            messages[k].options = {};
                        }
                    });
                    ws.sendPacket(new Packet(PACKETS.FETCH_CHANNEL, messages.map(i => i.encodeSafe())));
                    break;
                case "FETCH_USER":
                    const userId = json.id;
                    if (!userId) return;
                    ws.sendPacket(new Packet(PACKETS.FETCH_USER, ChatAPI.getUser(userId).encodeSafe()));
                    break;
                case "SEND_MESSAGE":
                    if (!(client.getChannel() instanceof Channel) || !client.getUser()) return;
                    if (!json.message) return;
                    let msg = json.message;
                    if (typeof msg !== "object") return;
                    delete msg.id;
                    delete msg.deleted;
                    delete msg.urls;
                    if (typeof msg.attachments !== "object" || !Array.isArray(msg.attachments)) delete msg.attachments;
                    msg.attachments = msg.attachments || [];
                    const urlRegexp = /[-a-zA-Z0-9@:%._\+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b([-a-zA-Z0-9()@:%_\+.~#?&//=]*)/;
                    let a = msg.content || "";
                    let s;
                    msg.id = db.add("id");
                    msg.urls = [];
                    let b = () => {
                        a = a.replace(s[0], "");
                        const n = createImageFromURL(
                            "https://" + s[0],
                            client.getChannel().id,
                            msg.id,
                            null
                        );
                        if (n) msg.attachments.push({
                            type: 1,
                            url: n.directory + "/" + n.name
                        });
                    }
                    for (let i = 0; i < 3; i++) if (!!(s = urlRegexp.exec(a))) b();
                    a = msg.content;
                    while (s = urlRegexp.exec(a)) {
                        a = a.replace(s[0], "");
                        msg.urls.push(s[0]);
                    }
                    Object.values(msg.attachments || []).forEach((attachment, k) => {
                        if (typeof attachment !== "object") return;
                        if (Object.keys(attachment) > 2) return delete msg.attachments[k];
                        switch (attachment.type) {
                            case 0: // FILE
                                if (!(attachment.buffer instanceof Buffer)) return delete msg.attachments[k];
                                const n = createImageFromBuffer(
                                    attachment.name,
                                    attachment.buffer,
                                    client.getChannel().id,
                                    msg.id,
                                    null
                                );
                                if (n) {
                                    msg.attachments[k] = {
                                        type: 0,
                                        url: n.directory + "/" + n.name
                                    };
                                } else delete msg.attachments[k];
                                break;
                            case 1:
                                break;
                            default:
                                delete msg.attachments[k];
                        }
                    });
                    const message = ChatAPI.Message.decode(msg);
                    if (!message.content || message.content.length > 1000) return;
                    message.author = client.userId;
                    message.createdTimestamp = Date.now();
                    message.content = message.content.replaceAll("<", "&zwnj;<&zwnj;").replaceAll(">", "&zwnj;>&zwnj;").replaceAll("\\", "&zwnj;\\&zwnj;")
                    client.getChannel().sendMessage(message);
                    break;
                case "EDIT_MESSAGE":
                    if (!client.getChannel() || !client.getUser()) return;
                    if (!json["id"] || !json.message) return;
                    const oldMsg = client.getChannel().getMessages().filter(i => !i.deleted && i.id === json["id"])[0];
                    if (!oldMsg || oldMsg.author !== client.userId) return;
                    let msgA = json.message;
                    if (typeof msgA !== "object") return;
                    delete msgA.id;
                    delete msgA.deleted;
                    msgA.id = oldMsg.id;
                    const messageA = ChatAPI.Message.decode(msgA);
                    messageA.author = client.userId;
                    messageA.createdTimestamp = Date.now();
                    messageA.content = messageA.content.replaceAll("<", "&zwnj;<&zwnj;").replaceAll(">", "&zwnj;>&zwnj;").replaceAll("\\", "&zwnj;\\&zwnj;")
                    client.getChannel().editMessage(messageA.id, messageA);
                    break;
                case "DELETE_MESSAGE":
                    if (!client.getChannel() || !client.getUser()) return;
                    if (!json["id"]) return;
                    const aa = client.getChannel().getMessages().filter(i => !i.deleted && i.id === json["id"])[0];
                    if (!aa || aa.author !== client.userId) return;
                    client.getChannel().deleteMessage(json["id"]);
                    break;
            }
        } catch (e) {
        }
    });
    ws.on("close", () => {
        delete clients[client.id];
    });
});

// UTILS

const randoms = "abcdefghijklmnoprstuvyzqwx0123456789".split("");
const generateAvatarName = () => " ".repeat(20).toString().split("").map(() => randoms[Math.floor(Math.random() * randoms.length)]).join("");

/**
 * @param {string} domain
 * @param {Buffer} buffer
 * @param {string|null} name
 * @returns {string|void}
 */
function createAvatarFromBuffer(domain, buffer, name = null) {
    const avatars = fs.readdirSync("./avatars/").map(i => i.split(".")[0]);
    while (!name || avatars.includes(name = generateAvatarName())) {
        name = generateAvatarName();
    }
    if (!module.exports.allowedDomains.includes("." + domain)) return;
    fs.writeFileSync("./avatars/" + name + "." + domain, buffer);
    return name;
}

/**
 * @param {string} url
 * @returns {string}
 */
function createAvatarFromURL(url) {
    const request = require('request');
    const name = generateAvatarName();
    request({url, encoding: null}, (err, res, buffer) => {
        if (err) return;
        const cA = res.rawHeaders[3];
        const cB = res.caseless["dict"]["content-type"];
        if (cA !== cB || typeof cA !== "string" || !cA.startsWith("image/")) return;
        const domain = cA.split("image/")[1];
        createAvatarFromBuffer(domain, buffer, name);
    });
    return name;
}

/**
 * @param {string|null} name
 * @param {Buffer} buffer
 * @param {number} channelId
 * @param {number} messageId
 * @param {number|null} guildId
 * @returns {{name: string, directory: string}}
 */
function createImageFromBuffer(name, buffer, channelId, messageId, guildId) {
    const directory = (guildId ? guildId + "/" : "") + channelId + "/" + messageId;
    name = name || "unknown.png";
    let nameA = name.split(".");
    const domain = nameA[nameA.length - 1];
    name = nameA.slice(0, nameA.length - 1).join(".");
    if (!module.exports.allowedDomains.includes("." + domain)) return;
    directory.split("/").forEach((i, k) => {
        if (k !== 0) i = directory.split("/").slice(0, k).join("/") + "/" + i;
        if (!fs.existsSync("./images/" + i))
            fs.mkdirSync("./images/" + i);
    });
    fs.writeFileSync("./images/" + directory + "/" + name + "." + domain, buffer);
    return {directory, name};
}

/**
 * @param {string} url
 * @param {number} channelId
 * @param {number} messageId
 * @param {number|null} guildId
 * @returns {{name: string, directory: string}}
 */
function createImageFromURL(url, channelId, messageId, guildId) {
    const request = require('request');
    let name = url.split("/")[url.split("/").length - 1].split("?")[0];
    name = name.split(".").slice(0, name.split(".").length - 1).join(".");
    request({url, encoding: null}, (err, res, buffer) => {
        if (err) return;
        const cA = res.rawHeaders[3];
        const cB = res.caseless["dict"]["content-type"];
        if (cA !== cB || typeof cA !== "string" || !cA.startsWith("image/")) return;
        const domain = cA.split("image/")[1];
        createImageFromBuffer(name + "." + domain, buffer, channelId, messageId, guildId);
    });
    const directory = (guildId ? guildId + "/" : "") + channelId + "/" + messageId;
    return {directory, name};
}

module.exports.Utils = {
    createAvatarFromBuffer: createAvatarFromBuffer,
    createAvatarFromURL: createAvatarFromURL,
    createImageFromURL: createImageFromURL,
    createImageFromBuffer: createImageFromBuffer,
};

// UTILS

app.get("/", (req, res) => {
    res.sendNode("index", {db, req, res, errors: []});
});

app.get("/login", (req, res) => {
    if (req.user) return res.redirect("/");
    res.sendNode("login", {email: req.query.email, db, req, res, errors: []});
});

app.post("/login", (req, res) => {
    const user = getLoginUser(req.body.email, req.body.password);
    if (!user) return res.sendNode("login", {email: req.body.email, db, req, res, errors: ["Wrong email or password!"]});
    passport.createSession(req, res, user.id);
});

app.get("/register", (req, res) => {
    if (req.user) return res.redirect("/");
    res.sendNode("register", {username: req.query.username, email: req.query.email, db, req, res, errors: []});
});

app.post("/register", (req, res) => {
    if (req.user) return res.redirect("/");
    const errors = [];
    // noinspection RegExpRedundantEscape
    const emailRegexp = /^(([^<>()[\]\\.,;:\s@"]+(\.[^<>()[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/;
    if (!req.body["email"] || !emailRegexp.test(req.body.email)) errors.push("You should provide a valid email.");
    if (Object.values(db.get("users", {})).some(i => i.email === req.body.email)) errors.push("This email is already in use.");
    if (!req.body["privacy"]) errors.push("You should agree Privacy Policy.");
    if (req.body.username.length < 6) errors.push("Too short username.");
    if (!/[a-z]|[0-9]|[A-Z]+/.test(req.body.username)) errors.push("Username cannot include things that they are not number and letter!");
    let a = /[0-9]/g.exec(req.body.password);
    if (req.body.password.length < 8 || !a || a.length > 2 || [...req.body.password].filter(i => !/[a-z]|[A-Z]|[0-9]/i.test(i)).length < 1) errors.push("Your password should have at least 8 characters, 2 numbers and one symbol.");
    let discriminator = Math.floor(Math.random() * 8889) + 1111;
    const uss = Object.values(db.get("users")).filter(i => i.username === req.body.username);
    if (uss.length > 50) {
        errors.push("So many users has this username!");
    } else {
        while (uss.some(i => i.discriminator === discriminator)) {
            discriminator = Math.floor(Math.random() * 8889) + 1111;
        }
    }
    if (errors.length > 0) return res.sendNode("register", {
        username: req.body.username,
        email: req.body.email,
        db,
        req,
        res,
        errors
    });
    let id = db.add("id");
    db.set(`users.${id}`, (new User(
        req.body.username,
        discriminator,
        req.body.email,
        req.body.password,
        id
    )).encode());
    res.redirect("/login?username=" + encodeURI(req.body.username));
});

app.get("/logout", (req, res) => {
    if (!req.user) return res.redirect("/");
    passport.removeSession(req);
    res.redirect(req.query.redirect || "/");
});

app.get("/api", (req, res) => {
    if (!req.query.action) return res.json({error: "Provide action!"});
    const run = require("./src/ExpressAPI").get[req.query.action];
    if (!run) return;
    run(req, res);
});

app.get("/users", (req, res) => {
    res.sendNode("users", {req, users: Object.values(db.get("users", {})).map(i => User.decode(i))})
});

app.get("/dms/:id", (req, res) => {
    if (!req.user) return res.redirect("/");
    if (req.params.id.toString() === req.user.id.toString()) return res.alt("You cannot dm with yourself!");
    if (!ChatAPI.getUser(req.params.id)) return res.alt("User not found!");
    const channel = ChatAPI.getDM(req.user.id * 1, req.params.id);
    if (!channel) return res.send("An error occurred!");
    res.redirect("/channels/" + channel.id);
});

app.get("/channels/:id", (req, res) => {
    if (!req.user) return res.redirect("/");
    const channel = ChatAPI.getChannel(req.params.id);
    if (!channel) return res.send("Channel not found!");
    if (!channel.users[req.user.id]) return res.alt("You cannot reach to this channel!");
    res.sendNode("channel", {
        channel, req, ChatAPI, moment: require("moment")
    });
});

app.get("/images/:channelId/:messageId/:name", (req, res) => {
    if (req.params.name.split(".").length > 2 || req.params.name.includes("/")) return res.json({error: "Invalid avatar url."});
    let name = req.params.name.split(".")[0];
    let domain = req.params.name.split(".")[1];
    if (!domain || !module.exports.allowedDomains.some(i => i === "." + domain)) domain = "png";
    if (!fs.existsSync("./images/" + req.params.channelId + "/" + req.params["messageId"] + "/" + name + "." + domain)) return res.json({error: "Image not found!"});
    res.sendFile(__dirname + "/images/" + req.params.channelId + "/" + req.params["messageId"] + "/" + name + "." + domain);
});

app.get("/images/:guildId/:channelId/:messageId/:name", (req, res) => {
    if (req.params.name.split(".").length > 2 || req.params.name.includes("/")) return res.json({error: "Invalid avatar url."});
    let name = req.params.name.split(".")[0];
    let domain = req.params.name.split(".")[1];
    if (!domain || !module.exports.allowedDomains.some(i => i === "." + domain)) domain = "png";
    if (!fs.existsSync("./images/" + req.params["guildId"] + "/" + req.params.channelId + "/" + req.params["messageId"] + "/" + name + "." + domain)) return res.json({error: "Image not found!"});
    res.sendFile(__dirname + "/images/" + req.params["guildId"] + "/" + req.params.channelId + "/" + req.params["messageId"] + "/" + name + "." + domain);
});

app.get("/avatars/:avatar", (req, res) => {
    if (req.params.avatar.split(".").length > 2 || req.params.avatar.includes("/")) return res.json({error: "Invalid avatar url."});
    let avatar = req.params.avatar.split(".")[0];
    let domain = req.params.avatar.split(".")[1];
    if (!domain || !module.exports.allowedDomains.some(i => i === "." + domain)) return res.redirect("/avatars/" + req.params.avatar + ".png");
    if (!fs.readdirSync("./avatars/").includes(avatar + "." + domain)) return res.json({error: "Avatar not found!"});
    res.sendFile(__dirname + "/avatars/" + req.params.avatar);
});

app.get("/avatars/user/:id", (req, res) => {
    const user = ChatAPI.getUser(req.params.id);
    if (!user) return res.json({error: "User not found!"});
    res.redirect("/avatars/" + user.avatar);
});

app.get("*", (req, res) => {
    res.send("<title>Chatty - 404</title><span>404 Page Not Found</span>");
});

app.listen(3000);