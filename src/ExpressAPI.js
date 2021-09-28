const ChatAPI = require("./ChatAPI");
const j = {
    LOGGED_IN: r => r.json({error: "You should be logged in to do this!", code: 0x0001}),
    SHOULD_NUMBER: (r, q) => r.json({error: `${q} should be a number!`, code: 0x0002}),
    SHOULD_STRING: (r, q) => r.json({error: `${q} should be a string!`, code: 0x0003}),
    SHOULD_CHANNEL: (r, q) => r.json({error: `${q} should be a valid channel!`, code: 0x0004}),
    SHOULD_USER: (r, q) => r.json({error: `${q} should be a valid user!`, code: 0x0005}),
    SHOULD_MESSAGE: (r, q) => r.json({error: `${q} should be a valid message!`, code: 0x0006}),
    JSON_ERROR: (r, q) => r.json({error: `JSON is invalid!`, dump: q, code: 0x0007}),
    JSON_NOT_OBJECT: r => r.json({error: `JSON is not Object!`, code: 0x0008}),
    NO_PERM: r => r.json({error: "You don't have permission to view this!", code: 0x0009}),
    CANNOT_DM: r => r.json({error: "You don't have any friendship with this user!", code: 0x0010}),
    DM_SELF: r => r.json({error: "You cannot dm yourself!", code: 0x0011}),
    CANNOT_EDIT_OTHERS_MESSAGE: r => r.json({error: "You cannot edit others' messages!", code: 0x0012}),
};

module.exports.get = {
    getChannelMessages(req, res) {
        const user = req.user;
        if (!user) return j.LOGGED_IN(res);
        let channel = req.query.channelId * 1;
        if (!channel) return j.SHOULD_NUMBER(res, "channelId");
        if (!(channel = ChatAPI.getChannel(channel))) return j.SHOULD_CHANNEL(res, "channelId");
        if (!channel.users[user.id]) return j.NO_PERM(res);
        res.json(channel.getMessages().filter(i=> !i.deleted).map(i => i.encode()));
    },
    getDmChannel(req, res) {
        const user = req.user;
        if (!user) return j.LOGGED_IN(res);
        const target = req.query.target * 1;
        if (!target) return j.SHOULD_NUMBER(res, "target");
        if (target === user["id"]) return j.DM_SELF(res);
        const dm = ChatAPI.getDM(user.id, target);
        if (!dm) return j.SHOULD_CHANNEL(res, "it");
        res.json(dm.encode(false));
    },
    getNotSeenMessages(req, res) {
        const user = req.user;
        if (!user) return j.LOGGED_IN(res);
        const id = req.query.id * 1;
        if (!id) return j.SHOULD_NUMBER(res, "id");
        let channel = req.query.channelId * 1;
        if (!channel) return j.SHOULD_NUMBER(res, "channelId");
        if (!(channel = ChatAPI.getChannel(channel))) return j.SHOULD_CHANNEL(res, "channelId");
        if (!channel.users[user.id]) return j.NO_PERM(res);
        res.json(ChatAPI.getChannel(channel).getNotSeenMessages(ChatAPI.getUser(user.id)));
    },
    /*
    sendMessage(req, res) {
        const user = req.user;
        if (!user) return j.LOGGED_IN(res);
        let channel = req.query.channelId * 1;
        if (!channel) return j.SHOULD_NUMBER(res, "channelId");
        if (!(channel = ChatAPI.getChannel(channel))) return j.SHOULD_CHANNEL(res, "channelId");
        if (!channel.users[user.id]) return j.NO_PERM(res);
        let message = req.query.message;
        if (!message) return j.SHOULD_STRING(res, "message");
        let json;
        try {
            json = JSON.parse(message);
        } catch (e) {
            return j.JSON_ERROR(res, e);
        }
        if (typeof json !== "object") return j.JSON_NOT_OBJECT(res);
        delete json.id;
        message = ChatAPI.Message.decode(json);
        message.author = user.id;
        message.createdTimestamp = Date.now();
        message.content = message.content.replaceAll("<", "&zwnj;<&zwnj;").replaceAll(">", "&zwnj;>&zwnj;").replaceAll("\\", "&zwnj;\\&zwnj;")
        channel.send(message);
        res.json({success: true});
    },*/
    getUser(req, res) {
        let user = req.user;
        if (!user || !(user = ChatAPI.getUser(user.id))) return j.LOGGED_IN(res);
        let target = req.query.target * 1;
        if (!target) return j.SHOULD_NUMBER(res, "target");
        if (!(target = ChatAPI.getUser(target))) return j.SHOULD_USER(res, "target");
        if (!ChatAPI.hasFriendship(user, target)) return j.CANNOT_DM(res);
        res.json(target.encodeSafe());
    },
    ping(req, res) {
        res.send(Date.now().toString());
    },
    /*
    editMessage(req, res) {
        const user = req.user;
        if (!user) return j.LOGGED_IN(res);
        let channel = req.query.channelId * 1;
        if (!channel) return j.SHOULD_NUMBER(res, "channelId");
        if (!(channel = ChatAPI.getChannel(channel))) return j.SHOULD_CHANNEL(res, "channelId");
        let messageId = req.query.messageId * 1;
        if (!messageId) return j.SHOULD_NUMBER(res, "messageId");
        if (!channel.getMessages().some(i => i.id === messageId)) return j.SHOULD_MESSAGE(res, "messageId");
        if (!channel.users[user.id]) return j.NO_PERM(res);
        const msg = channel.getMessages().filter(i => i.id === messageId && !i.deleted)[0];
        if (msg.author !== req.user.id) return j.CANNOT_EDIT_OTHERS_MESSAGE(res);
        let content = req.query.content;
        if (!content) return j.SHOULD_STRING(res, "content");
        channel.editMessage(messageId, content);
        res.json({success: true});
    },
    deleteMessage(req, res) {
        const user = req.user;
        if (!user) return j.LOGGED_IN(res);
        let channel = req.query.channelId * 1;
        if (!channel) return j.SHOULD_NUMBER(res, "channelId");
        if (!(channel = ChatAPI.getChannel(channel))) return j.SHOULD_CHANNEL(res, "channelId");
        let messageId = req.query.messageId * 1;
        if (!messageId) return j.SHOULD_NUMBER(res, "messageId");
        if (!channel.getMessages().some(i => i.id === messageId && !i.deleted)) return j.SHOULD_MESSAGE(res, "messageId");
        if (!channel.users[user.id]) return j.NO_PERM(res);
        const msg = channel.getMessages().filter(i => i.id === messageId && !i.deleted)[0];
        if (msg.author !== req.user.id) return j.NO_PERM(res); // TODO: fix this while adding channel system
        channel.deleteMessage(messageId);
        res.json({success: true});
    }*/
}