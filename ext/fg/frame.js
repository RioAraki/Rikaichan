/**
 * Logic of hover mouse retrieve text send to rikaikun
 */

let enabled = false;
let altView = 0;
let lastFound = null;
let keyHooked = false;
let paused = false;
let lbPop = false;
let lbLast = '';
let timer = null;
let ignoreMouseTime = 0;

let data = {};

//TODO modify options
let config = {
	popdelay: 40,
	highlight: true,
	title: true,
	resizedoc: false,
	nopopkeys: false,
	hidedef: false,
	usedpr: false,
	popdy: 25,
	skin:""
};

function sendMessageRikai(msg){
	return new Promise((resolve, reject) => {
		try {
			browser.runtime.sendMessage(msg, (result) => {
				resolve(result);
			});
		} catch (e) {
			reject(e.message);
		}
	});
}

function cursorInPopup(pos) {
	let popup = top.document.getElementById('rikaichan-window');
	return (popup && (popup.style.display !== 'none') &&
		(pos.pageX >= popup.offsetLeft) &&
		(pos.pageX <= popup.offsetLeft + popup.offsetWidth) &&
		(pos.pageY >= popup.offsetTop) &&
		(pos.pageY <= popup.offsetTop + popup.offsetHeight));
}

function onMouseMove(ev) {
	//	console.log('onMouseMove: sX=' + ev.screenX + ', sY=' + ev.screenY + ', target=' + ev.target.nodeName);

	if (ignoreMouseTime > 0) {
		if ((new Date()).getTime() <= ignoreMouseTime)
			return;
		ignoreMouseTime = 0;
	}

	// let rp = ev.rangeParent;
	// let ro = ev.rangeOffset;
	let car = document.caretPositionFromPoint(ev.clientX, ev.clientY);
	let rp = car.offsetNode;
	let ro = car.offset;

	if (cursorInPopup(ev)) {
        top.clearTimeout(timer);
		timer = null;
		return;
	}

	if (ev.target == data.prevTarget) {
		if (data.title) return;
		if ((rp == data.prevRangeNode) && (ro == data.prevRangeOfs)) return;
	}

    top.clearTimeout(timer);
	timer = null;

	//TODO to standart range
	// Node.TEXT_NODE == 3
	// if ((ev.explicitOriginalTarget.nodeType != 3) && !('form' in ev.target)) {
	 if ((rp.nodeType != 3) && !('form' in ev.target)) {
		rp = null;
		ro = -1;
	}

	data.prevTarget = ev.target;
	data.prevRangeNode = rp;
	data.prevRangeOfs = ro;
	data.title = null;
	data.uofs = 0;
	data.uofsNext = 1;

	if (ev.button != 0) return;
	if (lbPop) return;

	// if ((rp) && (rp.data) && (ro < rp.data.length)) {
	if (rp) {
        return sendMessageRikai({action:'data-select', index: ev.shiftKey ? -1 : 0 }).then(e =>{
            data.pos = { screenX: ev.screenX, screenY: ev.screenY, pageX: ev.pageX, pageY: ev.pageY, clientX: ev.clientX, clientY: ev.clientY };
            timer = top.setTimeout(show, config.popdelay);
            //return;
		});
	}

	if (config.options.general.tranAltTitle) {
		if ((typeof(ev.target.title) == 'string') && (ev.target.title.length)) {
			data.title = ev.target.title;
		}
		else if ((typeof(ev.target.alt) == 'string') && (ev.target.alt.length)) {
			data.title = ev.target.alt;
		}
	}

	if (ev.target.nodeName == 'OPTION') {
		data.title = ev.target.text;
	}
	else if (ev.target.nodeName == 'SELECT') {
		data.title = ev.target.options[ev.target.selectedIndex].text;
	}

	if (data.title) {
		data.pos = { screenX: ev.screenX, screenY: ev.screenY, pageX: ev.pageX, pageY: ev.pageY, clientX: ev.clientX, clientY: ev.clientY };
		timer = top.setTimeout(showTitle, config.popdelay);
		return;
	}

	if (data.pos) {
		// dont close just because we moved from a valid popup slightly over to a place with nothing
		let dx = data.pos.screenX - ev.screenX;
		let dy = data.pos.screenY - ev.screenY;
		let distance = Math.sqrt(dx * dx + dy * dy);
		if (distance > 4) {
			clearHi();
			hidePopup();
		}
	}
}


let inlineNames = {
	// text node
	'#text': true,

	// font style
	'FONT': true,
	'TT': true,
	'I' : true,
	'B' : true,
	'BIG' : true,
	'SMALL' : true,
	'STRIKE': true,
	'S': true,
	'U': true,

	// phrase
	'EM': true,
	'STRONG': true,
	'DFN': true,
	'CODE': true,
	'SAMP': true,
	'KBD': true,
	'VAR': true,
	'CITE': true,
	'ABBR': true,
	'ACRONYM': true,

	// special, not included IMG, OBJECT, BR, SCRIPT, MAP, BDO
	'A': true,
	'Q': true,
	'SUB': true,
	'SUP': true,
	'SPAN': true,
	'WBR': true,

	// ruby
	'RUBY': true,
	'RBC': true,
	'RTC': true,
	'RB': true,
	'RT': true,
	'RP': true
};

function xhtmlNS() {
	return 'http://www.w3.org/1999/xhtml';
}

// Gets text from a node and returns it
// node: a node
// selEnd: the selection end object will be changed as a side effect
// maxLength: the maximum length of returned string
function getInlineText(node, selEndList, maxLength) {
	// if ((node.nodeType == 3) && (node.data.length == 0)) return '';
	if ((node.nodeType === 3) && (node.textContent.length === 0)) return '';

	let text = '';
	// XPathResult.ORDERED_NODE_ITERATOR_TYPE == 5
	// let result = node.ownerDocument.evaluate('descendant-or-self::text()[not(parent::rp) and not(ancestor::rt)]', node, null, 5, null);
	let result = node.ownerDocument.evaluate('descendant-or-self::text()[not(parent::rp or ancestor::rt or parent::x:rp or ancestor::x:rt)]',
		node, xhtmlNS, 5, null);

	while ((maxLength > 0) && (node = result.iterateNext())) {
        text += node.textContent.substr(0, maxLength);
		// text += node.data.substr(0, maxLength);
		maxLength -= node.textContent.length;
		// maxLength -= node.data.length;
		selEndList.push(node);
	}

	return text;
}

// Given a node which must not be null, returns either the next sibling or
// the next sibling of the father or the next sibling of the fathers father
// and so on or null
function getNext(node) {
	do {
		if (node.nextSibling) return node.nextSibling;
		node = node.parentNode;
	} while ((node) && (inlineNames[node.nodeName]));
	return null;
}

function getTextFromRange(rangeParent, offset, selEndList, maxLength) {
	// XPathResult.BOOLEAN_TYPE = 3
	// if (rangeParent.ownerDocument.evaluate('boolean(parent::rp or ancestor::rt)', rangeParent, null, 3, null).booleanValue) {
	if (rangeParent.ownerDocument.evaluate('boolean(parent::rp or ancestor::rt or parent::x:rp or ancestor::x:rt)', rangeParent, xhtmlNS, 3, null).booleanValue) {
		return '';
	}

	// Node.TEXT_NODE = 3
	/*if (rangeParent.nodeType != 3) {
		return '';
	}*/
	/*let range = document.createRange();
	range.setStart(rangeParent, offset);
	range.setEnd(rangeParent, maxLength);
	range.toString().substr(offset, maxLength);*/

    //let text = range.toString().substr(offset, maxLength);
	// let text = rangeParent.data.substr(offset, maxLength);
	let text = rangeParent.textContent.substr(offset, maxLength);
	selEndList.push(rangeParent);

	let nextNode = rangeParent;
	while ((text.length < maxLength) &&
		((nextNode = getNext(nextNode)) != null) &&
		(inlineNames[nextNode.nodeName])) {
		text += getInlineText(nextNode, selEndList, maxLength - text.length);
	}

	return text;
}

function clearHi() {
	if (!data.prevSelView) return;
	if (data.prevSelView.closed) {
		data.prevSelView = null;
		return;
	}

	let sel = data.prevSelView.getSelection();
	if ((sel.isCollapsed) || (data.selText == sel.toString())) {
		sel.removeAllRanges();
	}
	data.prevSelView = null;
	data.kanjiChar = null;
	data.selText = null;
}

function highlightMatch(doc, rp, ro, matchLen, selEndList) {
	if (selEndList.length === 0) return;

	let selEnd;
	let offset = matchLen + ro;
	// before the loop
	// |----!------------------------!!-------|
	// |(------)(---)(------)(---)(----------)|
	// offset: '!!' lies in the fifth node
	// rangeOffset: '!' lies in the first node
	// both are relative to the first node
	// after the loop
	// |---!!-------|
	// |(----------)|
	// we have found the node in which the offset lies and the offset
	// is now relative to this node
	for (let i = 0; i < selEndList.length; ++i) {
		selEnd = selEndList[i]
		if (offset <= selEnd.data.length) break;
		offset -= selEnd.data.length;
	}

	let range = doc.createRange();
	range.setStart(rp, ro);
	range.setEnd(selEnd, offset);

	let sel = doc.defaultView.getSelection();
	if ((!sel.isCollapsed) && (data.selText != sel.toString()))
		return;
	sel.removeAllRanges();
	sel.addRange(range);
	data.selText = sel.toString();
}

async function show() {
	let rp = data.prevRangeNode;
	let ro = data.prevRangeOfs + data.uofs;
    config.hidedef = false;

	data.uofsNext = 1;

	if (!rp) {
		clearHi();
		hidePopup();
		return 0;
	}

	/*if ((ro < 0) || (ro >= rp.data.length)) {
		clearHi();
		hidePopup();
		return -1;
	}*/

	//selection end data
	let selEndList = [];
	let text = getTextFromRange(rp, ro, selEndList, 30);
	if (text.length == 0) {
		clearHi();
		hidePopup();
		return 0;
	}

	let e = {};
	e = await sendMessageRikai({action:'word-search', text: text});
	//e = e[0];

	 if (!e) {
		 hidePopup();
		 clearHi();
		 return 0;
	 }

	lastFound = [e];

	if (!e.matchLen) e.matchLen = 1;
	data.uofsNext = e.matchLen;
	data.uofs = (ro - data.prevRangeOfs);

	// don't try to highlight form elements
	if ((config.options.general.highlightText) && (!('form' in data.prevTarget))) {
		let doc = data.prevRangeNode.ownerDocument;
		if (!doc) {
			clearHi();
			hidePopup();
			return 0;
		}
		highlightMatch(doc, data.prevRangeNode, ro, e.matchLen, selEndList);
		data.prevSelView = doc.defaultView;
	}

	data.titleShown = false;
	showPopup(e.html, data.prevTarget, data.pos);

	return 1;
}

function showTitle() {
	sendMessageRikai({action: 'translate', text: data.title}).then(e =>{
		if (!e[0]) {
			hidePopup();
			return;
		}
		lastFound = [e];
		data.titleShown = true;
		showPopup(e.html, data.prevTarget, data.pos, false);
	});
}

function showPopup(text, elem, pos, _lbPop) {

	if (paused) return;
	if (!text) return;

	let root = top.document;

	// Positioning...
	// - The popup is inserted at the root document (if multi-frames).
	// - Event.client is relative to the current document under the mouse (may not be the root)
	// - Event.screen is relative to the top-left of the (current?????) monitor

	let x = 0;
	let y = 0;
	if (pos) {
		x = pos.screenX;
		y = pos.screenY;
	}

	lbPop = _lbPop;

	let popup = root.getElementById('rikaichan-window');
	if (!popup) {
		popup = root.createElementNS('http://www.w3.org/1999/xhtml', 'div');
		popup.setAttribute('id', 'rikaichan-window');
		root.documentElement.appendChild(popup);

		// if this is not set then Cyrillic text is displayed with Japanese
		// font, if the web page uses a Japanese code page as opposed to Unicode.
		// This makes it unreadable.
		popup.setAttribute('lang', 'en');

		popup.addEventListener('dblclick',
			function (ev) {
				hidePopup();
				ev.stopPropagation();
			}, true);

		if (config.options.general.enlargeSmallDocuments) {
			if ((root.body.clientHeight < 1024) && (root.body.style.minHeight == '')) {
				root.body.style.minHeight = '1024px';
				root.body.style.overflow = 'auto';
			}
		}
	}

	popup.style.maxWidth = (lbPop ? '' : '600px');

	if (root.contentType == 'text/plain') {
		let df = document.createDocumentFragment();
		let sp = document.createElementNS('http://www.w3.org/1999/xhtml', 'span');
		df.appendChild(sp);
		sp.innerHTML = text;
		while (popup.firstChild) {
			popup.removeChild(popup.firstChild);
		}
		popup.appendChild(df);
	}
	else {
		popup.innerHTML = text;
	}

	if (elem) {
		popup.style.top = '-1000px';
		popup.style.left = '0px';
		popup.style.display = '';

		let width = popup.offsetWidth;
		let height = popup.offsetHeight;

		if (altView == 1) {
			// upper-left
			x = 0;
			y = 0;
		}
		else if (altView == 2) {
			// lower-right
			x = (top.innerWidth - (width + 20));
			y = (top.innerHeight - (height + 20));
		}
		else {
			// https://developer.mozilla.org/en-US/docs/Web/API/Window/mozInnerScreenX
			// https://developer.mozilla.org/en-US/docs/Web/API/Window/devicePixelRatio
			// https://developer.mozilla.org/en-US/docs/Mozilla/Tech/XPCOM/Reference/Interface/nsIDOMWindowUtils
			// mozInnerScreenX * screenPixelsPerCSSPixel -> can't get nsIDOMWindowUtils from here (?)

			// convert xy relative to root document position where popup was inserted
			if (config.options.general.useDPR) {
				let r = top.devicePixelRatio || 1;
				x = (x / r) - top.mozInnerScreenX;
				y = (y / r) - top.mozInnerScreenY;
			}
			else {
				x -= top.mozInnerScreenX;
				y -= top.mozInnerScreenY;
			}


			// note: mousemove is not being triggered for <OPTION> elements
/*
			if (elem instanceof Components.interfaces.nsIDOMHTMLOptionElement) {
				// these things are always on z-top, so go sideways
				x -= pos.pageX;
				y -= pos.pageY;
				let p = elem;
				while (p) {
					x += p.offsetLeft;
					y += p.offsetTop;
					p = p.offsetParent;
				}

				// right side of box
				let w = elem.parentNode.offsetWidth + 5;
				x += w;

				if ((x + width) > top.innerWidth) {
					// too much to the right, go left
					x -= (w + width + 5);
					if (x < 0) x = 0;
				}

				if ((y + height) > top.innerHeight) {
					y = top.innerHeight - height - 5;
					if (y < 0) y = 0;
				}
			}
			else
*/
			 {
				// go left if necessary
				if ((x + width) > (top.innerWidth - 20)) {
					x = (top.innerWidth - width) - 20;
					if (x < 0) x = 0;
				}

				// below the mouse
				let v = config.options.general.PopDY;

				// under the popup title
				if ((elem.title) && (elem.title != '')) v += 20;

				// go up if necessary
				if ((y + v + height) > top.innerHeight) {
					let t = y - height - 30;
					if (t >= 0) y = t;
				}
				else y += v;
			}
		}
	}

	popup.style.left = (x + top.scrollX) + 'px';
	popup.style.top = (y + top.scrollY) + 'px';
	popup.style.display = '';

	if (!keyHooked) {
		addEventListener('keydown', onKeyDown, true);
		keyHooked = true;
	}
}

function hidePopup() {
	let popup = top.document.getElementById('rikaichan-window');
	if (popup) {
		popup.style.display = 'none';
		popup.innerHTML = '';
	}
	lbPop = false;
	data.title = null;
}

function removePopup() {
	let popup = top.document.getElementById('rikaichan-window');
	if (popup) popup.parentNode.removeChild(popup);
}

function isVisible() {
	let popup = top.document.getElementById('rikaichan-window');
	return (popup) && (popup.style.display != 'none');
}

function onMouseDown(ev) {
	// console.log('onMouseDown: buttons=' + ev.buttons);
	if (!cursorInPopup(ev)) hidePopup();
}


function getPrevTextNode(e, n) {
	while (true) {
		let x = e.lastChild;
		while (x) {
			if (x.nodeType == 3) {
				if (x.data.length > 0) return x;
			}
			else  if (n < 100) {
				let y = getPrevTextNode(x, n + 1);
				if (y) return y;
			}
			x = x.previousSibling;
		}
		while (!e.previousSibling) {
			if (n > 0) return null;
			e = e.parentNode;
			if (!e) return null;
		}
		e = e.previousSibling;
		if ((e.nodeType == 3) && (e.data.length > 0)) return e;
	}
}

function getNextTextNode(e, n) {
	while (true) {
		let x = e.firstChild;
		while (x) {
			if (x.nodeType == 3) {
				if (x.data.length > 0) return x;
			}
			else  if (n < 100) {
				let y = getNextTextNode(x, n + 1);
				if (y) return y;
			}
			x = x.nextSibling;
		}
		while (!e.nextSibling) {
			if (n > 0) return null;
			e = e.parentNode;
			if (!e) return null;
		}
		e = e.nextSibling;
		if ((e.nodeType == 3) && (e.data.length > 0)) return e;
	}
}

async function showNext() {
	let n = 100;
	while (n-- > 0) {
		if (data.uofsNext <= 0) data.uofsNext = 1;
		data.uofs += data.uofsNext;

        await sendMessageRikai({action:'data-select', index: 0});
		let r = await show();
		if (r === 1) break;
		if (r === -1) {
			data.prevRangeNode = getNextTextNode(data.prevRangeNode, 0);
			if (!data.prevRangeNode) break;

			data.prevRangeOfs = 0;
			data.prevTarget = data.prevRangeNode;
			data.uofs = -1;
			data.uofsNext = 1;
		}
	}
}

async function showPrev() {
	let n = 100;
	let ofs = data.uofs;
	while (n-- > 0) {
		if (--ofs < 0) {
			data.prevRangeNode = getPrevTextNode(data.prevRangeNode, 0);
			if (!data.prevRangeNode) break;

			ofs = data.prevRangeNode.length - 1;
			if (ofs < 0) break;

			data.prevRangeOfs = 0;
			data.prevTarget = data.prevRangeNode;
			data.uofsNext = 1;
		}
		data.uofs = ofs;
        await sendMessageRikai({action:'data-select', index: 0});
		if (await show() !== 0) break;
	}
}

function copyToClipboard(text) {
    function oncopy(event) {
        document.removeEventListener("copy", oncopy, true);
        // Hide the event from the page to prevent tampering.
        event.stopImmediatePropagation();
        // Overwrite the clipboard content.
        event.preventDefault();
        event.clipboardData.setData("text/plain", text);
    }
    document.addEventListener("copy", oncopy, true);
    document.execCommand("copy");
    showPopup(browser.i18n.getMessage("copyToClipboard"));
}

function onKeyDown(ev) {
	// console.log('onKeyDown: keyCode=' + ev.keyCode + ' charCode=' + ev.charCode + ' detail=' + ev.detail);

	if ((ev.altKey) || (ev.metaKey) || (ev.ctrlKey)) return;
	if ((ev.shiftKey) && (ev.keyCode !== 16)) return;
	if ((config.nopopkeys) && (ev.keyCode !== 16)) return;
	if (ev.repeat) return;

    if (ev.target.id ==='rikaichan-toolbar-input'){
        switch (ev.keyCode) {
            case 13:
                lookup();
                break;
			case 27:
                hidePopup();
                clearHi();
        }
        return;
    }
	if (!isVisible()) return;

	switch (ev.keyCode) {
	case 13:	// enter
		clearHi();
		// continues...
	case 16:	// shift
        sendMessageRikai({action:'data-next'}).then(e =>{
            if (data.titleShown) {
                showTitle();
            }else {
                show();
            }
		});
        break;
	case 27:	// esc
		hidePopup();
		clearHi();
		break;
	case 65:	// a
		altView = (altView + 1) % 3;
		show();
		break;
	case 68:	// d
		config.hidedef = !config.hidedef;
		if (config.hidedef) showPopup(browser.i18n.getMessage("hidingDefinitions"));
			else show();
		break;
	case 67:	// c
		if (lastFound) {
            sendMessageRikai({action:'get-format-text', entries: lastFound}).then(text =>{
                copyToClipboard(text);
			});
		}
		break;
	case 83:	// s
		if (lastFound) {
            sendMessageRikai({action:'save', entries: lastFound}).then(e=>{
                showPopup(browser.i18n.getMessage("saveToFile"));
			});
		}
		break;
	case 66:	// b
		showPrev();
		break;
	case 77:	// m (next character)
		data.uofsNext = 1;
        //break; ???
	case 78:	// n
		showNext();
		break;
	default:
		if ((ev.keyCode >= 49) && (ev.keyCode <= 57)) {	// 1-9
            sendMessageRikai({action:'data-select', index:(ev.keyCode - 49)}).then(
                show()
			);
			break;
		}
		return;
	}

	// don't eat shift if in this mode
	if (!config.nopopkeys) {
		ev.stopPropagation();
		ev.preventDefault();
	}
}

function updateOptions(options) {
	config.options = Object.assign({}, options);
    config.hidedef = config.options.dictOptions.hideDef;

	if(options.general.skin !== config.skin){
        setRikaichanSkin();
	}
}

function setRikaichanSkin() {
    let root = top.document;
    let style = root.getElementById('rikaichan-skin');
    if (!style) {
        style = root.createElementNS('http://www.w3.org/1999/xhtml', 'style');
        style.id = 'rikaichan-skin';
    }
    sendMessageRikai({action: 'load-skin'}).then(result => {
            config.skin = result.skin;
            style.innerHTML = result.css;
            root.head.appendChild(style);
        });
}

function enable() {
	if (enabled) return;
	enabled = true;
	paused = false;
    sendMessageRikai({action: 'load-options'});
    setRikaichanSkin();

	addEventListener('mousemove', onMouseMove, false);
	addEventListener('mousedown', onMouseDown, false);
/*
	if (!keyHooked) {
		addEventListener('keydown', onKeyDown, true);
		keyHooked = true;
	}
*/

	// duplicate in lowercase for xhtml
	if (!inlineNames['a']) {
		for (let n in inlineNames) {
			inlineNames[n.toLowerCase()] = true;
		}
	}
}

function disable() {
	removeEventListener('mousemove', onMouseMove, false);
	removeEventListener('mousedown', onMouseDown, false);
	removeEventListener('keydown', onKeyDown, true);
	keyHooked = false;

	hidePopup();
	clearHi();

	let popup = top.document.getElementById('rikaichan-window');
	if (popup) popup.parentNode.removeChild(popup);
    let style = top.document.getElementById('rikaichan-skin');
	if (style) style.parentNode.removeChild(style);

	enabled = false;
}

function getSelected(win) {
	let text;
	let s = win.getSelection();
	if (s) {
		text = s.toString();
		if (text.search(/[^\s]/) !== -1) return text;
	}
	for (let i = 0; i < win.frames.length; ++i) {
		text = getSelected(win.frames[i]);
		if (text.length > 0) return text;
	}
	return '';
}

function clearSelected(win) {
	let s = win.getSelection();
	if (s) s.removeAllRanges();
	for (let i = 0; i < win.frames.length; ++i) {
		clearSelected(win.frames[i]);
	}
}


function toogleToolbar(state){
    let root = top.document;
    let rikaiToolbar = root.getElementById('rikaichan-toolbar');
    if(!rikaiToolbar){
        setRikaichanSkin();
        rikaiToolbar = root.createElementNS('http://www.w3.org/1999/xhtml', 'div');
        rikaiToolbar.id = 'rikaichan-toolbar';
        rikaiToolbar.setAttribute("class","rikaichan-toolbar-toolbar");
        let rikaiToolbarInput = root.createElementNS('http://www.w3.org/1999/xhtml', 'input');

        rikaiToolbarInput.id = 'rikaichan-toolbar-input';
        rikaiToolbarInput.setAttribute("class", "rikaichan-input");
        rikaiToolbarInput.onkeydown = onKeyDown;

        let rikaiToolbarSearch = root.createElementNS('http://www.w3.org/1999/xhtml', 'button');
        rikaiToolbarSearch.setAttribute("class","rikaichan-btn rikaichan-search");
        rikaiToolbarSearch.onclick = lookup;
        let rikaiToolbarCopy = root.createElementNS('http://www.w3.org/1999/xhtml', 'button');
        rikaiToolbarCopy.onclick = () => {
            if (!lastFound) return;
            sendMessageRikai({action:'get-format-text', entries: lastFound}).then(text =>{
                copyToClipboard(text);
            });
		};
        rikaiToolbarCopy.setAttribute("class","rikaichan-btn rikaichan-copy");
        let rikaiToolbarSave = root.createElementNS('http://www.w3.org/1999/xhtml', 'button');
        rikaiToolbarSave.onclick  = () =>{
            if (!lastFound) return;
                sendMessageRikai({action:'save', entries: lastFound}).then(e=>{
                    showPopup(browser.i18n.getMessage("saveToFile"));
                });
		};
        rikaiToolbarSave.setAttribute("class","rikaichan-btn rikaichan-save");

        rikaiToolbar.appendChild(rikaiToolbarInput);
        rikaiToolbar.appendChild(rikaiToolbarSearch);
        rikaiToolbar.appendChild(rikaiToolbarCopy);
        rikaiToolbar.appendChild(rikaiToolbarSave);
        root.body.insertBefore(rikaiToolbar, root.body.firstChild);
        lookup(false);
        wanakana.bind(rikaiToolbarInput);
	}else{
        rikaiToolbar.parentNode.removeChild(rikaiToolbar);
	}
}

async function lookup() {
    let text = getSelected(top).substr(0, 30).replace(/^\s+|\s+$/g, '');
    if (text === ""){
        text = top.document.getElementById('rikaichan-toolbar-input').value;
	}else {
        top.document.getElementById('rikaichan-toolbar-input').value = text;
	}
    clearSelected(top);
	// console.log('lookup text=', text, ' checkSelected=', checkSelected);

	text = text.replace(/^\s+|\s+$/g, '');
	if (text === "") return;


	if ((lbLast == text) && (isVisible())) {
        await sendMessageRikai({action:'data-next', text: text});
	}
	else {
		lbLast = text;
        await sendMessageRikai({action:'data-select', index: 0});
	}

    let result = await sendMessageRikai({action:'lookup-search', text: text});

	if (!result || (result.entries === null && result.kanjis.length === 0)) {
		showPopup('\u300C ' + text + ' \u300D ' + browser.i18n.getMessage("notFound"), null, {screenX:0, screenY:40}, true);
		lastFound = null;
		return;
	}

	lastFound = [result.entries].concat(result.kanjis);
	lastFound.fromLB = true;

	let kanjis = '';
	for (let i = 0; i < result.kanjis.length; ++i) {
		kanjis += '<td class="q-k">' + result.kanjis[i].html + '</td>';
	}
    let entryHtml = "";
	if(result.html !== ""){
		entryHtml = '<td class="q-w">' + result.html + '</td>';
	}

	showPopup('<table class="q-tb"><tr>' + entryHtml + kanjis + '</tr></table>', null, {screenX:0, screenY:40}, true);
}




function processMessage (request, sender, sendResponse) {
	if (!request.action)
		return;
	const action = request.action;
	if (action === 'enable') {
		enable();
		showPopup(request.data);
	}
	else if (action === 'disable') {
		disable();
	}
	if(action === 'show'){
		ignoreMouseTime = (new Date()).getTime() + 2000;
		showPopup(request.data);
	}
	if(action === 'optionsSet'){
		updateOptions(request.data);
	}
    if (action === 'toolbar') {
        toogleToolbar(request.data);
    }
}

browser.runtime.onMessage.addListener(processMessage);

sendMessageRikai({action:'insert-frame'});