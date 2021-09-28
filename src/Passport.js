const cookie = require("cookie");
const tokens = new (require("./Database"))("tokens.json");
const randoms = "abcdefghijklmnoprstuvyzqwx!'^+%&/()=?_1234567890".split("");
const generateToken = () => " ".repeat(50).toString().split("").map(() => randoms[Math.floor(Math.random() * randoms.length)]).join("");
const ChatAPI = require("./ChatAPI");
let id = 0;

module.exports.callback = (req, res, next) => {
    const token = cookie.parse(req.headers.cookie || '')["cli.id"] || '';
    const session = tokens.get(token);
    if (!session) {
        if(token !== "unknown") {
            res.setHeader('Set-Cookie', cookie.serialize("cli.id", "unknown", {
                httpOnly: true,
                maxAge: 60 * 60 * 24 * 7
            }));
            res.statusCode = 302;
            res.setHeader('Location', "/");
            res.end();
        }
        return next();
    }
    if(!ChatAPI.getUser(session.id)) return next();
    req.user = session;
    req.token = token;
    return next();
}

module.exports.getTokensById = id => Object.values(tokens.json).filter(i=> i.id === id).map(i=> i.token);

module.exports.getSession = token => tokens.get(token);

module.exports.createSession = (req, res, id, redirect = "/") => {
    if (req.user) return false;
    let token = generateToken();
    while(tokens.get(token)) {
        token = generateToken();
    }
    tokens.set(token, {
        id: id++,
        user: req.user,
        token: token
    });
    res.setHeader('Set-Cookie', cookie.serialize("cli.id", token, {
        httpOnly: true,
        maxAge: 60 * 60 * 24 * 7
    }));
    res.statusCode = 302;
    res.setHeader('Location', redirect);
    res.end();
    return true;
}

module.exports.removeSession = (req) => {
    const token = cookie.parse(req.headers.cookie || '')["cli.id"];
    tokens.remove(token);
}