const fs = require("fs");
const j = JSON.stringify;

module.exports = class Database {
    constructor(file) {
        if(!file) return;
        if(!fs.existsSync("./" + file))
            fs.writeFileSync("./" + file, "{}");
        this._file = file;
        this.json = JSON.parse(fs.readFileSync("./" + file).toString());
        setInterval(() => this.save(), 5000);
    }
    set(data, value) {
        this.get(data);
        eval(`this.json${data.split(".").map(i=> `[${j(i)}]`).join("")} = ${JSON.stringify(value)}`);
    }
    remove(data) {
        this.get(data);
        eval(`delete this.json${data.split(".").map(i=> `[${j(i)}]`).join("")}`);
    }
    get(data, def = null) {
        data.split(".").slice(0, data.split(".").length-1).forEach((p, i)=> {
            if(!eval(`this.json${data.split(".").slice(0, i+1).map(i=> `[${j(i)}]`).join("")}`))
                eval(`this.json${data.split(".").slice(0, i+1).map(i=> `[${j(i)}]`).join("")} = {}`);
        });
        const res = eval(`this.json${data.split(".").map(i=> `[${j(i)}]`).join("")}`);
        if(def && !res) this.set(data, def);
        return res || def;
    }
    add(data, value = 1) {
        value = this.get(data, 0) + value;
        this.set(data, value);
        return value;
    }
    push(data, value) {
        this.set(data, [...this.get(data, []), value]);
    }
    unpush(data, value) {
        this.set(data, (this.get(data) || []).filter(i => i !== value));
    }
    save() {
        if(j(JSON.parse(fs.readFileSync("./" + this._file).toString())) === j(this.json)) return;
        fs.writeFileSync("./" + this._file, j(this.json));
    }
}