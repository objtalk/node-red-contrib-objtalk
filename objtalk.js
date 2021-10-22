module.exports = async (RED) => {
	const { Connection } = require("./lib/objtalk.js");
	
	function setConnectionStatus(node, serverConn) {
		if (serverConn.connection.open)
			node.status({ fill: "green", shape: "dot", text: "node-red:common.status.connected" });
		else
			node.status({ fill: "red", shape: "ring", text: "node-red:common.status.disconnected" });
		
		serverConn.connection.addEventListener("open", () => {
			node.status({ fill: "green", shape: "dot", text: "node-red:common.status.connected" });
		});
		
		serverConn.connection.addEventListener("close", () => {
			node.status({ fill: "red", shape: "ring", text: "node-red:common.status.disconnected" });
		});
	}
	
	function ObjtalkServerNode(n) {
		RED.nodes.createNode(this, n);
		
		this.url = n.url;
		this.connection = new Connection(this.url);
	}
	
	function ObjtalkQueryNode(n) {
		RED.nodes.createNode(this, n);
		
		this.pattern = n.pattern;
		this.server = n.server;
		this.serverConn = RED.nodes.getNode(this.server);
		this.query = null;
		
		if (this.serverConn) {
			this.query = this.serverConn.connection.query(this.pattern);
			
			this.query.addEventListener("open", objects => {
				this.status({ fill: "green", shape: "dot", text: "node-red:common.status.connected" });
				
				for (let object of objects) {
					let msg = {
						event: "add",
						initial: true,
						payload: object,
					};
					this.send([null, msg, null, null, null]);
				}
			});
			
			this.query.addEventListener("close", () => {
				this.status({ fill: "red", shape: "ring", text: "node-red:common.status.disconnected" });
			});
			
			this.query.addEventListener("update", () => {
				let msg = {
					event: "update",
					payload: this.query.objects,
				};
				this.send([msg, null, null, null, null]);
			});
			
			this.query.addEventListener("add", object => {
				let msg = {
					event: "add",
					payload: object,
				};
				this.send([null, msg, null, null, null]);
			});
			
			this.query.addEventListener("change", object => {
				let msg = {
					event: "change",
					payload: object,
				};
				this.send([null, null, msg, null, null]);
			});
			
			this.query.addEventListener("remove", object => {
				let msg = {
					event: "remove",
					payload: object,
				};
				this.send([null, null, null, msg, null]);
			});
			
			this.query.addEventListener("event", event => {
				let msg = {
					object: event.object,
					event: event.event,
					payload: event.data,
				};
				this.send([null, null, null, null, msg]);
			});
		}
		
		this.on("close", (removed, done) => {
			if (this.query) {
				this.query.stop();
				this.query = null;
			}
			
			done();
		});
	}
	
	function ObjtalkSetNode(n) {
		RED.nodes.createNode(this, n);
		
		this.object = n.object;
		this.server = n.server;
		this.serverConn = RED.nodes.getNode(this.server);
		
		if (this.serverConn) {
			setConnectionStatus(this, this.serverConn);
			
			this.on("input", (msg, send, done) => {
				let object = this.object || msg.object;
				
				if (!object) {
					this.warn("invalid object name");
					done();
					return;
				}
				
				this.serverConn.connection.set(object, msg.payload)
					.then(() => done())
					.catch(e => {
						this.error("can't set object: " + e);
						done();
					});
			});
		}
	}
	
	function ObjtalkPatchNode(n) {
		RED.nodes.createNode(this, n);
		
		this.object = n.object;
		this.server = n.server;
		this.serverConn = RED.nodes.getNode(this.server);
		
		if (this.serverConn) {
			setConnectionStatus(this, this.serverConn);
			
			this.on("input", (msg, send, done) => {
				let object = this.object || msg.object;
				
				if (!object) {
					this.warn("invalid object name");
					done();
					return;
				}
				
				this.serverConn.connection.patch(object, msg.payload)
					.then(() => done())
					.catch(e => {
						this.error("can't patch object: " + e);
						done();
					});
			});
		}
	}
	
	function ObjtalkEmitNode(n) {
		RED.nodes.createNode(this, n);
		
		this.object = n.object;
		this.event = n.event;
		this.server = n.server;
		this.serverConn = RED.nodes.getNode(this.server);
		
		if (this.serverConn) {
			setConnectionStatus(this, this.serverConn);
			
			this.on("input", (msg, send, done) => {
				let object = this.object || msg.object;
				let event = this.event || msg.event;
				
				if (!object) {
					this.warn("invalid object name");
					done();
					return;
				}
				
				if (!event) {
					this.warn("invalid event name");
					done();
					return;
				}
				
				this.serverConn.connection.emit(object, event, msg.payload)
					.then(() => done())
					.catch(e => {
						this.error("can't emit event: " + e);
						done();
					});
			});
		}
	}
	
	function ObjtalkGetNode(n) {
		RED.nodes.createNode(this, n);
		
		this.pattern = n.pattern;
		this.destination = n.destination;
		this.server = n.server;
		this.serverConn = RED.nodes.getNode(this.server);
		
		if (this.serverConn) {
			this.on("input", (msg, send, done) => {
				let pattern = this.pattern || msg.pattern;
				
				if (!pattern) {
					this.warn("invalid pattern");
					done();
					return;
				}
				
				this.serverConn.connection.get(pattern)
					.then(objects => {
						msg[this.destination] = objects;
						send(msg);
						done();
					})
					.catch(e => {
						this.error("can't set object: " + e);
						done();
					});
			});
		}
	}
	
	RED.nodes.registerType("objtalk-server", ObjtalkServerNode);
	RED.nodes.registerType("objtalk query", ObjtalkQueryNode);
	RED.nodes.registerType("objtalk get", ObjtalkGetNode);
	RED.nodes.registerType("objtalk set", ObjtalkSetNode);
	RED.nodes.registerType("objtalk patch", ObjtalkPatchNode);
	RED.nodes.registerType("objtalk emit", ObjtalkEmitNode);
};
