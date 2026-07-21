const assert = require("assert");
const fs = require("fs");
const path = require("path");

function read(relativePath) {
  return fs.readFileSync(path.join(__dirname, "..", relativePath), "utf8");
}

const view = read("miniprogram/pages/social-chat/social-chat.wxml");
const style = read("miniprogram/pages/social-chat/social-chat.wxss");
const page = read("miniprogram/pages/social-chat/social-chat.js");

assert.match(view, /class="partner-title-row"/);
assert.match(view, /class="relationship-badge"/);
assert.match(view, /你们已互相确认，可以直接聊天/);
assert.match(view, /class="safety-menu"[^>]*role="button"/);
assert.match(view, /class="menu-dot"/);
assert.doesNotMatch(view, /<button class="safety-menu"/);
assert.doesNotMatch(view, />•••<\/button>/);

assert.match(style, /\.safety-menu\s*\{[^}]*flex:\s*0 0 64rpx/s);
assert.match(style, /\.safety-menu-pressed\s*\{[^}]*scale\(\.94\)/s);
assert.match(style, /\.partner-name\s*\{[^}]*text-overflow:\s*ellipsis/s);
assert.doesNotMatch(page, /setNavigationBarTitle\(\{\s*title:\s*profile\.nickname/);

console.log("social chat header tests passed");
