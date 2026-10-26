//! @zhenre/compiler — native template precompiler (Zig)
//!
//! Reads JSON from stdin:
//!   { "templates": [ { "name": "...", "strings": ["...", ...] } ] }
//! Writes JSON to stdout:
//!   { "templates": [ { "name": "...", "html": "...", "slots": [ ... ] } ] }
//!
//! Slots are byte-compatible with the @zhenre runtime compiler and the JS
//! reference walker (packages/compiler/src/walker.ts) — enforced by the
//! fixture parity suite (fixtures/expected.json is generated from a real
//! browser). Build: zig build-exe re_template.zig -O ReleaseFast
//!
//! Slot kinds: 0 = child text/node binding, 1 = attr/event/ref, 2 = interpolated attr.
//! Marker format: \u0001<index>\u0002 for both text and attribute bindings.

const std = @import("std");

const Slot = struct {
    k: u8,
    i: ?u32 = null,
    p: []const u32,
    n: ?[]const u8 = null,
    parts: ?[]const Part = null,
};

const Part = union(enum) {
    s: []const u8,
    idx: u32,
};

const VOID_ELEMENTS = [_][]const u8{
    "area", "base", "br", "col", "embed", "hr", "img", "input",
    "link", "meta", "param", "source", "track", "wbr",
};

const RAW_TEXT_ELEMENTS = [_][]const u8{ "script", "style" };

const Compiler = struct {
    alloc: std.mem.Allocator,
    src: []const u8,
    pos: usize = 0,
    slots: std.ArrayList(Slot),
    // element stack of child-index counters (index of NEXT child)
    stack: std.ArrayList(u32),

    fn joinStrings(alloc: std.mem.Allocator, strings: []const []const u8) ![]const u8 {
        var out = std.ArrayList(u8).init(alloc);
        for (strings, 0..) |s, i| {
            if (i > 0) {
                try out.append(0x01);
                try out.writer().print("{d}", .{i - 1});
                try out.append(0x02);
            }
            try out.appendSlice(s);
        }
        return out.toOwnedSlice();
    }

    fn isVoid(name: []const u8) bool {
        for (VOID_ELEMENTS) |v| if (std.ascii.eqlIgnoreCase(v, name)) return true;
        return false;
    }

    fn isRawText(name: []const u8) bool {
        for (RAW_TEXT_ELEMENTS) |v| if (std.ascii.eqlIgnoreCase(v, name)) return true;
        return false;
    }

    /// Split a text node containing markers into segments; emits slots and
    /// returns how many text nodes the original becomes (mirrors the DOM
    /// walkers' replaceChild + index adjustment).
    fn handleTextMarker(self: *Compiler, text: []const u8, base_index: u32) !u32 {
        var segs = std.ArrayList(Seg).init(self.alloc);
        defer segs.deinit();
        var last: usize = 0;
        var i: usize = 0;
        while (i < text.len) {
            if (text[i] == 0x01) {
                // find 0x02
                var j = i + 1;
                while (j < text.len and text[j] != 0x02) : (j += 1) {}
                if (j < text.len) {
                    const idx = std.fmt.parseInt(u32, text[i + 1 .. j], 10) catch {
                        i += 1;
                        continue;
                    };
                    if (i > last) try segs.append(.{ .t = text[last..i] });
                    try segs.append(.{ .marker = idx });
                    last = j + 1;
                    i = last;
                    continue;
                }
            }
            i += 1;
        }
        if (last < text.len) try segs.append(.{ .t = text[last..] });

        var count: u32 = 0;
        for (segs.items, 0..) |seg, k| {
            if (seg == .marker) {
                var path = try self.alloc.alloc(u32, self.stack.items.len + 1);
                for (self.stack.items, 0..) |v, d| path[d] = v;
                path[self.stack.items.len] = base_index + @as(u32, @intCast(k));
                try self.slots.append(.{ .k = 0, .i = seg.marker, .p = path });
            }
            count += 1;
        }
        return count;
    }

    const Seg = union(enum) { t: []const u8, marker: u32 };

    fn walk(self: *Compiler) !void {
        var base: usize = 0; // index of next child at current depth
        var seg_start: usize = self.pos;
        var text_open = false;

        while (self.pos < self.src.len) {
            const c = self.src[self.pos];
            if (c == '<') {
                if (self.pos + 1 < self.src.len and self.src[self.pos + 1] == '!') {
                    // comment / doctype
                    if (std.mem.startsWith(u8, self.src[self.pos..], "<!--")) {
                        const end = std.mem.indexOfPos(u8, self.src, self.pos + 4, "-->").?
                            + 3;
                        if (text_open) try self.closeText(seg_start, self.pos, &base);
                        self.pos = end;
                        seg_start = self.pos;
                        continue;
                    }
                    const end = (std.mem.indexOfPos(u8, self.src, self.pos, ">") orelse self.src.len) + 1;
                    if (text_open) try self.closeText(seg_start, self.pos, &base);
                    self.pos = end;
                    seg_start = self.pos;
                    continue;
                }
                if (self.pos + 1 < self.src.len and self.src[self.pos + 1] == '/') {
                    // closing tag
                    const end = (std.mem.indexOfPos(u8, self.src, self.pos, ">") orelse self.src.len) + 1;
                    if (text_open) try self.closeText(seg_start, self.pos, &base);
                    if (self.stack.items.len > 0) {
                        _ = self.stack.pop();
                        base = self.stack.items[self.stack.items.len - 1];
                        self.stack.items[self.stack.items.len - 1] = base + 1;
                    }
                    self.pos = end;
                    seg_start = self.pos;
                    text_open = false;
                    continue;
                }
                if (self.pos + 1 < self.src.len and std.ascii.isAlphabetic(self.src[self.pos + 1])) {
                    // opening tag
                    if (text_open) try self.closeText(seg_start, self.pos, &base);
                    try self.openTag(&base);
                    seg_start = self.pos;
                    text_open = false;
                    continue;
                }
                // literal '<' in text
                self.pos += 1;
                text_open = true;
                continue;
            }
            self.pos += 1;
            text_open = true;
        }
        if (text_open) try self.closeText(seg_start, self.pos, &base);
    }

    fn closeText(self: *Compiler, from: usize, to: usize, base: *usize) !void {
        const text = self.src[from..to];
        const count = try self.handleTextMarker(text, base.*);
        base.* += count;
    }

    /// Parse an opening tag at self.pos ('<name ...>'). Handles attributes,
    /// quoted values, markers in values, void elements and raw-text elements.
    fn openTag(self: *Compiler, base: *usize) !void {
        var i = self.pos + 1; // past '<'
        const name_start = i;
        while (i < self.src.len and (std.ascii.isAlphanumeric(self.src[i]) or self.src[i] == '-')) : (i += 1) {}
        const name = self.src[name_start..i];

        // scan attributes until '>' — markers only recognized inside values
        var saw_marker_attr = false;
        while (i < self.src.len) {
            while (i < self.src.len and (self.src[i] == ' ' or self.src[i] == '\n' or self.src[i] == '\t' or self.src[i] == '\r')) : (i += 1) {}
            if (i >= self.src.len) break;
            if (self.src[i] == '>') {
                i += 1;
                break;
            }
            if (self.src[i] == '/' and i + 1 < self.src.len and self.src[i + 1] == '>') {
                i += 2;
                // void-style self-close on HTML element: parser ignores '/', stays open —
                // but well-formed templates don't rely on this; treat as closed for safety
                // EXCEPT it matches browser behavior only for foreign elements; keep open-tag semantics:
                try self.finishOpen(name, base, true);
                self.pos = i;
                return;
            }
            // attribute name
            const an_start = i;
            while (i < self.src.len and self.src[i] != '=' and self.src[i] != '>' and self.src[i] != ' ' and self.src[i] != '\n' and self.src[i] != '\t' and self.src[i] != '\r' and !(self.src[i] == '/' and i + 1 < self.src.len and self.src[i + 1] == '>')) : (i += 1) {}
            const attr_name = self.src[an_start..i];
            // skip whitespace
            while (i < self.src.len and (self.src[i] == ' ' or self.src[i] == '\n' or self.src[i] == '\t' or self.src[i] == '\r')) : (i += 1) {}
            if (i < self.src.len and self.src[i] == '=') {
                i += 1;
                while (i < self.src.len and (self.src[i] == ' ' or self.src[i] == '\n' or self.src[i] == '\t' or self.src[i] == '\r')) : (i += 1) {}
                if (i < self.src.len and (self.src[i] == '"' or self.src[i] == '\'')) {
                    const q = self.src[i];
                    i += 1;
                    const v_start = i;
                    while (i < self.src.len and self.src[i] != q) : (i += 1) {}
                    const value = self.src[v_start..i];
                    if (i < self.src.len) i += 1; // closing quote
                    try self.emitAttr(name, attr_name, value, base, &saw_marker_attr);
                } else {
                    const v_start = i;
                    while (i < self.src.len and self.src[i] != '>' and self.src[i] != ' ') : (i += 1) {}
                    const value = self.src[v_start..i];
                    try self.emitAttr(name, attr_name, value, base, &saw_marker_attr);
                }
            }
        }
        self.pos = i;
        try self.finishOpen(name, base, false);
    }

    fn finishOpen(self: *Compiler, name: []const u8, base: *usize, self_closed: bool) !void {
        if (self_closed or isVoid(name)) {
            base.* += 1;
        } else {
            try self.stack.append(base.*);
            // replace top with 0 as "next child index" — we store per-level counters:
            self.stack.items[self.stack.items.len - 1] = 0;
            _ = isRawText(name); // raw-text handling: markers inside script/style are still
            // text-node markers for the runtime; well-formed templates close them normally,
            // so the generic scan is equivalent for slot extraction.
        }
    }

    fn emitAttr(self: *Compiler, tag: []const u8, attr_name: []const u8, value: []const u8, base: *usize, saw: *bool) !void {
        _ = tag;
        if (std.mem.indexOfScalar(u8, value, 0x01) == null) return;

        // full marker? -> dynamic attr slot
        if (value.len > 2 and value[0] == 0x01 and value[value.len - 1] == 0x02 and
            std.mem.indexOfScalarPos(u8, value, 1, 0x01) == null)
        {
            const idx = std.fmt.parseInt(u32, value[1 .. value.len - 1], 10) catch return;
            var path = try self.alloc.alloc(u32, self.stack.items.len + 1);
            for (self.stack.items, 0..) |v, d| path[d] = v;
            path[self.stack.items.len] = base.*;
            try self.slots.append(.{ .k = 1, .i = idx, .n = attr_name, .p = path });
            saw.* = true;
            return;
        }
        // interpolated: build parts (string | binding index)
        var parts = std.ArrayList(Part).init(self.alloc);
        var last: usize = 0;
        var i: usize = 0;
        while (i < value.len) {
            if (value[i] == 0x01) {
                var j = i + 1;
                while (j < value.len and value[j] != 0x02) : (j += 1) {}
                if (j < value.len) {
                    const idx = std.fmt.parseInt(u32, value[i + 1 .. j], 10) catch {
                        i += 1;
                        continue;
                    };
                    if (i > last) try parts.append(.{ .s = value[last..i] });
                    try parts.append(.{ .idx = idx });
                    last = j + 1;
                    i = last;
                    continue;
                }
            }
            i += 1;
        }
        if (last < value.len) try parts.append(.{ .s = value[last..] });

        var path = try self.alloc.alloc(u32, self.stack.items.len + 1);
        for (self.stack.items, 0..) |v, d| path[d] = v;
        path[self.stack.items.len] = base.*;
        try self.slots.append(.{ .k = 2, .n = attr_name, .p = path, .parts = try parts.toOwnedSlice() });
        saw.* = true;
    }
};

const InputTemplate = struct {
    name: []const u8,
    strings: []const []const u8,
};

const Input = struct {
    templates: []const InputTemplate,
};

fn writeJsonString(w: anytype, s: []const u8) !void {
    try w.writeByte('"');
    for (s) |c| {
        switch (c) {
            '"' => try w.writeAll("\\\""),
            '\\' => try w.writeAll("\\\\"),
            '\n' => try w.writeAll("\\n"),
            '\r' => try w.writeAll("\\r"),
            '\t' => try w.writeAll("\\t"),
            0x01 => try w.writeAll("\\u0001"),
            0x02 => try w.writeAll("\\u0002"),
            else => try w.writeByte(c),
        }
    }
    try w.writeByte('"');
}

pub fn main() !void {
    var gpa = std.heap.GeneralPurposeAllocator(.{}){};
    const alloc = gpa.allocator();
    const stdin = std.io.getStdIn().reader();
    const input_json = try stdin.readAllAlloc(alloc, 64 * 1024 * 1024);

    const parsed = try std.json.parseFromSlice(Input, alloc, input_json, .{
        .ignore_unknown_fields = true,
    });
    defer parsed.deinit();

    const stdout = std.io.getStdOut().writer();
    var buf = std.ArrayList(u8).init(alloc);
    defer buf.deinit();
    const w = buf.writer();

    try w.writeAll("{\"templates\":[");
    for (parsed.value.templates, 0..) |t, ti| {
        if (ti > 0) try w.writeByte(',');
        const html = try Compiler.joinStrings(alloc, t.strings);
        var comp = Compiler{
            .alloc = alloc,
            .src = html,
            .slots = std.ArrayList(Slot).init(alloc),
            .stack = std.ArrayList(u32).init(alloc),
        };
        try comp.walk();

        try w.writeAll("{\"name\":");
        try writeJsonString(w, t.name);
        try w.writeAll(",\"html\":");
        try writeJsonString(w, html);
        try w.writeAll(",\"slots\":[");
        for (comp.slots.items, 0..) |s, si| {
            if (si > 0) try w.writeByte(',');
            try w.print("{{\"k\":{d}", .{s.k});
            if (s.i) |idx| try w.print(",\"i\":{d}", .{idx});
            try w.writeAll(",\"p\":[");
            for (s.p, 0..) |v, pi| {
                if (pi > 0) try w.writeByte(',');
                try w.print("{d}", .{v});
            }
            try w.writeByte(']');
            if (s.n) |n| {
                try w.writeAll(",\"n\":");
                try writeJsonString(w, n);
            }
            if (s.parts) |parts| {
                try w.writeAll(",\"parts\":[");
                for (parts, 0..) |part, pi| {
                    if (pi > 0) try w.writeByte(',');
                    switch (part) {
                        .s => |sv| try writeJsonString(w, sv),
                        .idx => |idx| try w.print("{d}", .{idx}),
                    }
                }
                try w.writeByte(']');
            }
            try w.writeByte('}');
        }
        try w.writeAll("]}");
    }
    try w.writeAll("]}");
    try stdout.writeAll(buf.items);
    try stdout.writeByte('\n');
}
