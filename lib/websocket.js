const { EventEmitter } = require("./events.js");
const InternalWebSocket = require("ws");

class WebSocket extends EventEmitter {
	constructor(url) {
		super();
		
		this.ws = new InternalWebSocket(url);
		this.ws.addEventListener("open", () => this.dispatchEvent("open"));
		this.ws.addEventListener("close", () => this.dispatchEvent("close"));
		this.ws.addEventListener("error", e => this.dispatchEvent("error", e));
		this.ws.addEventListener("message", event => this.dispatchEvent("message", event.data));
	}
	
	send(...args) {
		return this.ws.send(...args);
	}
}

module.exports = { WebSocket };
