const { EventEmitter } = require("./events.js");
const { WebSocket } = require("./websocket.js");

const STATE_CONNECTING = "connecting";
const STATE_OPEN = "open";
const STATE_CLOSED = "closed";

class Connection extends EventEmitter {
	constructor(url) {
		super();
		this.url = url;
		this.state = STATE_CLOSED;
		this.websocket = null;
		this.nextRequestId = 1;
		this.requests = {};
		this.connect();
	}
	
	get open() {
		return this.state == STATE_OPEN;
	}
	
	connect() {
		if (this.state != STATE_CLOSED)
			throw new Error("can't connect in state " + this.state);
		
		this.state = STATE_CONNECTING;
		
		this.websocket = new WebSocket(this.url);
		
		this.websocket.addEventListener("open", () => {
			console.log("objtalk open");
			
			this.state = STATE_OPEN;
			this.dispatchEvent("open");
		});
		this.websocket.addEventListener("close", () => {
			console.log("objtalk closed");
			
			let wasOpen = this.state == STATE_OPEN;
			this.state = STATE_CLOSED;
			this.websocket = null;
			if (wasOpen)
				this.dispatchEvent("close");
			
			setTimeout(() => {
				this.connect();
			}, 1000);
		});
		this.websocket.addEventListener("message", data => {
			data = JSON.parse(data);
			//console.log("msg", data);
			
			if ("requestId" in data) {
				if (this.requests.hasOwnProperty(data.requestId)) {
					let { resolve, reject } = this.requests[data.requestId];
					delete this.requests[data.requestId];
					
					if ("error" in data)
						reject(data.error);
					else
						resolve(data.result);
				}
			} else if ("type" in data) {
				if (!["open", "close"].includes(data.type)) {
					this.dispatchEvent(data.type, data);
				}
			}
		});
		this.websocket.addEventListener("error", e => {
			console.error(e);
		});
	}
	
	send(msg) {
		if (this.state != STATE_OPEN)
			throw new Error("can't send messages in state " + this.state);
		
		//console.log("send", msg);
		this.websocket.send(JSON.stringify(msg));
	}
	
	request(msg) {
		return new Promise((resolve, reject) => {
			let requestId = this.nextRequestId++;
			msg.id = requestId;
			
			this.requests[requestId] = { resolve, reject };
			this.send(msg);
		});
	}
	
	async get(pattern) {
		let objects = {};
		let result = await this.request({ type: "get", pattern });
		for (let object of result.objects)
			objects[object.name] = object;
		return objects;
	}
	
	set(name, value) {
		return this.request({ type: "set", name, value });
	}
	
	patch(name, value) {
		return this.request({ type: "patch", name, value });
	}
	
	async remove(name) {
		let { existed } = await this.request({ type: "remove", name });
		return existed;
	}
	
	query(pattern, listener, options = {}) {
		options = { provideRpc: false, ...options };
		let query = new Query(pattern, options, this);
		
		if (listener)
			query.addEventListener("update", () => listener(query.objects));
		
		return query;
	}
	
	provide(pattern, listener, options = {}) {
		options = { provideRpc: true, ...options };
		let query = new Query(pattern, options, this);
		
		query.addEventListener("invocation", event => {
			try {
				listener({
					object: query.objects[event.object],
					objects: query.objects,
					method: event.method,
					args: event.args,
					reply: event.reply,
				});
			} catch (e) {
				console.error(e);
				event.reply(null, "internal error");
				throw e;
			}
		});
		
		return query;
	}
	
	unsubscribe(queryId) {
		return this.request({ type: "unsubscribe", queryId });
	}
	
	emit(object, event, data) {
		return this.request({ type: "emit", object, event, data });
	}
	
	invoke(object, method, args) {
		return this.request({ type: "invoke", object, method, args });
	}
	
	invokeResult(invocationId, result) {
		return this.request({ type: "invokeResult", invocationId, result });
	}
}

class Query extends EventEmitter {
	constructor(pattern, options, connection) {
		super();
		this.state = STATE_CLOSED;
		this.pattern = pattern;
		this.connection = connection;
		this.queryId = null;
		this.objects = {};
		this.options = options;
		
		this._onOpen = this._onOpen.bind(this);
		this._onClose = this._onClose.bind(this);
		this._onAdd = this._onAdd.bind(this);
		this._onChange = this._onChange.bind(this);
		this._onRemove = this._onRemove.bind(this);
		this._onEvent = this._onEvent.bind(this);
		this._onInvocation = this._onInvocation.bind(this);
		
		this.connection.addEventListener("open", this._onOpen);
		this.connection.addEventListener("close", this._onClose);
		this.connection.addEventListener("queryAdd", this._onAdd);
		this.connection.addEventListener("queryChange", this._onChange);
		this.connection.addEventListener("queryRemove", this._onRemove);
		this.connection.addEventListener("queryEvent", this._onEvent);
		this.connection.addEventListener("queryInvocation", this._onInvocation);
		
		this.start();
	}
	
	start() {
		if (this.state != STATE_CLOSED)
			throw new Error("can't create query in state " + this.state);
		
		if (this.connection.open) {
			this.state = STATE_CONNECTING;
			
			this.connection.request({
				type: "query",
				pattern: this.pattern,
				provideRpc: this.options.provideRpc,
			}).then(({ queryId, objects }) => {
				if (this.state == STATE_CONNECTING) {
					this.state = STATE_OPEN;
					this.queryId = queryId;
					
					this.objects = {};
					for (let object of objects)
						this.objects[object.name] = object;
					
					this.dispatchEvent("open", objects);
					this.dispatchEvent("update");
				} else if (this.state == STATE_CLOSED) {
					this.connection.unsubscribe(queryId);
				}
			}).catch(error => {
				console.log("error", error);
			});
		}
	}
	
	stop() {
		if (this.state == STATE_OPEN) {
			this.connection.unsubscribe(this.queryId);
		}
		
		this.state = STATE_CLOSED;
		
		this.connection.removeEventListener("open", this._onOpen);
		this.connection.removeEventListener("close", this._onClose);
		this.connection.removeEventListener("queryAdd", this._onAdd);
		this.connection.removeEventListener("queryChange", this._onChange);
		this.connection.removeEventListener("queryRemove", this._onRemove);
		this.connection.removeEventListener("queryEvent", this._onEvent);
		this.connection.removeEventListener("queryInvocation", this._onInvocation);
	}
	
	_onOpen() {
		if (this.state == STATE_CLOSED) {
			this.start();
		}
	}
	
	_onClose() {
		if (this.state == STATE_OPEN) {
			this.state = STATE_CLOSED;
			this.dispatchEvent("close");
		}
	}
	
	_onAdd(data) {
		if (data.queryId == this.queryId) {
			this.objects[data.object.name] = data.object;
			this.dispatchEvent("add", data.object);
			this.dispatchEvent("update");
		}
	}
	
	_onChange(data) {
		if (data.queryId == this.queryId) {
			this.objects[data.object.name] = data.object;
			this.dispatchEvent("change", data.object);
			this.dispatchEvent("update");
		}
	}
	
	_onRemove(data) {
		if (data.queryId == this.queryId) {
			delete this.objects[data.object.name];
			this.dispatchEvent("remove", data.object);
			this.dispatchEvent("update");
		}
	}
	
	_onEvent(data) {
		if (data.queryId == this.queryId) {
			this.dispatchEvent("event", data);
		}
	}
	
	_onInvocation(data) {
		if (data.queryId == this.queryId) {
			this.dispatchEvent("invocation", {
				...data,
				reply: (result) => {
					return this.connection.invokeResult(data.invocationId, result);
				},
			});
		}
	}
}

module.exports = { Connection };
