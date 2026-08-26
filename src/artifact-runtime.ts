export const ARTIFACT_RUNTIME_JS = `(function(){
  var pending = new Map();
  var seq = 0;
  function invoke(verb, args){
    var callId = "hcall-" + (++seq) + "-" + Date.now();
    return new Promise(function(resolve, reject){
      var timer = setTimeout(function(){
        if (!pending.has(callId)) return;
        pending.delete(callId);
        reject(new Error("host_invoke_timeout"));
      }, 10000);
      pending.set(callId, { resolve: resolve, reject: reject, timer: timer });
      window.parent.postMessage({ type: "my-ax:host-invoke", callId: callId, verb: verb, args: args || {} }, "*");
    });
  }
  window.addEventListener("message", function(event){
    var data = event.data;
    if (!data || data.type !== "my-ax:host-invoke-result") return;
    var entry = pending.get(data.callId);
    if (!entry) return;
    clearTimeout(entry.timer);
    pending.delete(data.callId);
    if (data.ok) entry.resolve(data.result);
    else entry.reject(new Error(data.error || "host_invoke_failed"));
  });
  var state = null;
  var stateListeners = [];
  window.addEventListener("message", function(event){
    var data = event.data;
    if (data && data.type === "my-ax:artifact-theme") {
      if (data.theme === "light") document.documentElement.setAttribute("data-theme", "light");
      else document.documentElement.removeAttribute("data-theme");
      return;
    }
    if (!data || data.type !== "my-ax:artifact-state") return;
    state = data.state;
    for (var i = 0; i < stateListeners.length; i++) {
      try { stateListeners[i](state); } catch (e) {}
    }
  });
  window.myax = {
    invoke: invoke,
    listSessions: function(limit){ return invoke("listSessions", limit ? { limit: limit } : {}); },
    switchSession: function(sessionId){ return invoke("switchSession", { sessionId: sessionId }); },
    sendToSession: function(sessionId, content){ return invoke("sendToSession", { sessionId: sessionId, content: content }); },
    notify: function(text, kind){ return invoke("notify", kind ? { text: text, kind: kind } : { text: text }); },
    deskRead: function(){ return invoke("deskRead", {}); },
    deskWrite: function(next){ return invoke("deskWrite", { state: JSON.stringify(next) }); },
    readVersion: function(){ return invoke("readVersion", {}); },
    getState: function(){ return state; },
    onState: function(fn){ stateListeners.push(fn); if (state !== null) { try { fn(state); } catch (e) {} } return function(){ stateListeners = stateListeners.filter(function(x){ return x !== fn; }); }; },
    submit: function(value, send){ window.parent.postMessage({ type: "my-ax:artifact-submit", value: String(value), send: send === true }, "*"); },
    register: function(tools){ window.parent.postMessage({ type: "my-ax:artifact-register", tools: tools }, "*"); }
  };
})();`;
