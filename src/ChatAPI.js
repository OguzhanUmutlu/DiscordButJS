let db = new (require("./Database"))();

module.exports = {
    setDatabase(database) {
        db = database;
    },
    getDM(from, to) {
        const channel = Object.values(db.get(`channels`, {})).filter(i => i.options.type === "dm" && Object.values(i.users).length === 2 && i.users[from] && i.users[to])[0];
        return channel ? module.exports.Channel.decode(channel) : this.createDM(from, to);
    },
    getChannel(id) {
        const channel = db.get(`channels.${id}`);
        if (!channel) return null;
        return module.exports.Channel.decode(channel);
    },
    createDM(from, to) {
        from = from * 1;
        to = to * 1;
        const users = {};
        users[from] = from;
        users[to] = to;
        if (from === to) return null;
        const channel = new module.exports.Channel(
            users,
            -1,
            {},
            {
                type: "dm"
            }
        );
        this.createChannel(channel);
        return channel;
    },
    createChannel(channel) {
        channel.id = db.add("id");
        db.set(`channels.${channel.id}`, channel.encode());
        return channel.id;
    },
    getLoginUser(email, password) {
        return Object.values(db.get("users", {})).filter(i => i.email === email && i.password === password)[0];
    },
    getUser(id) {
        const user = db.get(`users.${id}`);
        if (!user) return null;
        return module.exports.User.decode(user);
    },
    hasFriendship(one, two) {
        return true;
    }
}


const PACKETS = {
    "CHANNEL_MENTION_UPDATE": 0x0001,
    "MESSAGE_CREATE": 0x0002,
    "MESSAGE_DELETE": 0x0003,
    "MESSAGE_EDIT": 0x0004,
    "FETCH_USER": 0x0005,
    "FETCH_CHANNEL": 0x0006,
};
module.exports.PACKETS = PACKETS;

class Packet {
    constructor(id, value) {
        this.id = id;
        this.value = value;
    }

    encode() {
        return {
            id: this.id,
            value: this.value
        };
    }
}
Packet.decode = pk => new Packet(pk.id, pk.value);

module.exports.Packet = Packet;

class Channel {
    constructor(users, id, lastSeen = {}, options = {}) {
        if (!options.type) throw new TypeError("Invalid channel type.");
        this.users = users; // {int $id: int $id}
        this.lastSeen = lastSeen; // {int $id: int $timestamp}
        this.id = id; // int $id
        this.options = options; // {type: "dm"}
    }

    sendPacketToViewers(pk) {
        Object.values(require("../server").clients()).filter(i=> i.channelId === this.id).forEach(client => {
            client.ws.sendPacket(pk);
        });
    }

    sendPacketToUsers(pk) {
        Object.keys(this.users).forEach(userId => {
            Object.values(require("../server").clients()).filter(i=> i.userId === userId).forEach(client => {
                client.ws.sendPacket(pk);
            });
        });
    }

    deleteMessage(messageId) {
        const mgs = db.get(`channels.${this.id}.messages`, []);
        if(!mgs[Object.keys(mgs).filter(k=>mgs[k].id === messageId)[0]]) return;
        mgs[Object.keys(mgs).filter(k=>mgs[k].id === messageId)[0]].deleted = true;
        db.set(`channels.${this.id}.messages`, mgs);
        this.sendPacketToViewers(new Packet(PACKETS.MESSAGE_DELETE, {
            id: messageId
        }));
    }

    editMessage(messageId, newMessage) {
        const mgs = db.get(`channels.${this.id}.messages`, []);
        if(!mgs[Object.keys(mgs).filter(k=>mgs[k].id === messageId)[0]]) return;
        const nms = newMessage.encode();
        nms.options.edited = Date.now();
        mgs[Object.keys(mgs).filter(k=>mgs[k].id === messageId)[0]] = nms;
        db.set(`channels.${this.id}.messages`, mgs);
        this.sendPacketToViewers(new Packet(PACKETS.MESSAGE_EDIT, newMessage.encodeSafe()));
    }

    sendMessage(message) {
        db.push(`channels.${this.id}.messages`, message.encode());
        if (this.options.type === "dm" || this.options.type === "group") {
            this.sendPacketToUsers(new Packet(PACKETS.CHANNEL_MENTION_UPDATE, {
                id: this.id
            }));
        } else {
            // TODO: <@> mention for text channels
        }
        this.sendPacketToViewers(new Packet(PACKETS.MESSAGE_CREATE, message.encodeSafe()));
    }

    getNotSeenMessages(user) {
        if (!this.users[user] || !this.lastSeen[user]) return [];
        return this.getMessages().filter(i=> !i.deleted).filter(i => i.createdTimestamp > this.lastSeen[user]);
    }

    getMessages() {
        return db.get(`channels.${this.id}.messages`, []).map(module.exports.Message.decode);
    }

    encode(deletedMessages = true) {
        const m = this.getMessages().map(i => i.encode());
        return {
            id: this.id,
            users: this.users,
            lastSeen: this.lastSeen,
            messages: deletedMessages ? m : m.filter(i=> !i.deleted),
            options: this.options
        };
    }
}

module.exports.Channel = Channel;
module.exports.Channel.decode = (channel) => new module.exports.Channel(
    channel.users,
    channel.id,
    channel.lastSeen,
    channel.options
);

module.exports.Message = class Message {
    constructor(author, content, createdTimestamp, id, deleted = false, attachments = [], urls = [], options = {}) {
        this.author = author; // int $id
        this.content = content; // string $content
        this.createdTimestamp = createdTimestamp; // int $createdTimestamp
        this.id = id || db.add("id"); // int $id
        this.deleted = deleted;
        this.attachments = attachments;
        this.urls = urls;
        this.options = options; // array $options
    }

    encode() {
        return {
            author: this.author,
            content: this.content,
            createdTimestamp: this.createdTimestamp,
            id: this.id,
            deleted: this.deleted,
            attachments: this.attachments,
            urls: this.urls,
            options: this.options
        };
    }

    encodeSafe() {
        const author = module.exports.getUser(this.author);
        return {
            author: author ? author.encodeSafe() : {id: this.author, deleted: true},
            content: this.content,
            createdTimestamp: this.createdTimestamp,
            id: this.id,
            deleted: this.deleted,
            attachments: this.attachments,
            urls: this.urls,
            options: this.options
        };
    }
}
module.exports.Message.decode = (message) => new module.exports.Message(
    message.author,
    message.content,
    message.createdTimestamp,
    message.id,
    message.deleted,
    message.attachments,
    message.urls,
    message.options
);

module.exports.User = class User {
    constructor(username, discriminator, email, password, id, avatar = null, status) {
        this.username = username;
        this.discriminator = discriminator;
        this.email = email;
        this.password = password;
        this.id = id || db.add("id");
        this.avatar = avatar || "default";
        this.status = status;
    }

    setStatus(status) {
        this.status = status;
        db.set(`users.${this.id}.status`, status);
    }

    sendPacket(pk) {
        const tokens = require("./Passport").getTokensById(this.id);
        const clients = Object.values(require("../server").clients()).filter(i=> tokens.includes(i.token));
        clients.forEach(client => {
            client.ws.sendPacket(pk.encode());
        });
    }

    setUsername(username) {
        this.username = username;
        db.set(`users.${this.id}.username`, username);
    }

    setPassword(password) {
        this.password = password;
        db.set(`users.${this.id}.password`, password);
    }

    encode() {
        return {
            username: this.username,
            discriminator: this.discriminator,
            email: this.email,
            password: this.password,
            id: this.id,
            avatar: this.avatar,
            status: this.status
        };
    }

    encodeSafe() {
        return {
            username: this.username,
            discriminator: this.discriminator,
            avatar: this.avatar,
            status: this.status,
            id: this.id
        };
    }
}
module.exports.User.decode = user => new module.exports.User(user.username, user.discriminator, user.email, user.password, user.id, user.avatar, user.status);