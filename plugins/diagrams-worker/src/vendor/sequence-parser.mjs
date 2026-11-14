const __name = (fn, name) => Object.defineProperty(fn, "name", {value:name, configurable:true});
// src/diagrams/sequence/parser/sequenceDiagram.jison
var parser = (function() {
  var o = /* @__PURE__ */ __name(function(k, v, o2, l) {
    for (o2 = o2 || {}, l = k.length; l--; o2[k[l]] = v) ;
    return o2;
  }, "o"), $V0 = [1, 2], $V1 = [1, 3], $V2 = [1, 4], $V3 = [2, 4], $V4 = [1, 9], $V5 = [1, 11], $V6 = [1, 12], $V7 = [1, 14], $V8 = [1, 15], $V9 = [1, 17], $Va = [1, 18], $Vb = [1, 19], $Vc = [1, 25], $Vd = [1, 26], $Ve = [1, 27], $Vf = [1, 28], $Vg = [1, 29], $Vh = [1, 30], $Vi = [1, 31], $Vj = [1, 32], $Vk = [1, 33], $Vl = [1, 34], $Vm = [1, 35], $Vn = [1, 36], $Vo = [1, 37], $Vp = [1, 38], $Vq = [1, 39], $Vr = [1, 40], $Vs = [1, 42], $Vt = [1, 43], $Vu = [1, 44], $Vv = [1, 45], $Vw = [1, 46], $Vx = [1, 47], $Vy = [1, 4, 5, 10, 14, 15, 17, 19, 22, 24, 30, 31, 32, 34, 36, 37, 38, 39, 40, 42, 44, 45, 47, 48, 49, 50, 51, 53, 54, 56, 61, 62, 63, 64, 73], $Vz = [1, 56], $VA = [1, 75], $VB = [1, 81], $VC = [1, 82], $VD = [1, 83], $VE = [1, 84], $VF = [1, 85], $VG = [1, 86], $VH = [1, 87], $VI = [1, 88], $VJ = [1, 89], $VK = [1, 90], $VL = [1, 91], $VM = [1, 92], $VN = [1, 93], $VO = [1, 94], $VP = [1, 95], $VQ = [1, 96], $VR = [1, 97], $VS = [1, 98], $VT = [1, 99], $VU = [1, 100], $VV = [1, 101], $VW = [1, 102], $VX = [1, 103], $VY = [1, 104], $VZ = [1, 105], $V_ = [1, 106], $V$ = [2, 79], $V01 = [2, 78], $V11 = [4, 5, 17, 51, 53, 54], $V21 = [4, 5, 10, 14, 15, 17, 19, 22, 24, 30, 31, 32, 34, 36, 37, 38, 39, 40, 42, 44, 45, 47, 51, 53, 54, 56, 61, 62, 63, 64, 73], $V31 = [4, 5, 10, 14, 15, 17, 19, 22, 24, 30, 31, 32, 34, 36, 37, 38, 39, 40, 42, 44, 45, 47, 50, 51, 53, 54, 56, 61, 62, 63, 64, 73], $V41 = [4, 5, 10, 14, 15, 17, 19, 22, 24, 30, 31, 32, 34, 36, 37, 38, 39, 40, 42, 44, 45, 47, 49, 51, 53, 54, 56, 61, 62, 63, 64, 73], $V51 = [4, 5, 10, 14, 15, 17, 19, 22, 24, 30, 31, 32, 34, 36, 37, 38, 39, 40, 42, 44, 45, 47, 48, 51, 53, 54, 56, 61, 62, 63, 64, 73], $V61 = [5, 52], $V71 = [62, 70, 71, 72, 73], $V81 = [62, 73], $V91 = [1, 152];
  var parser2 = {
    trace: /* @__PURE__ */ __name(function trace() {
    }, "trace"),
    yy: {},
    symbols_: { "error": 2, "start": 3, "SPACE": 4, "NEWLINE": 5, "SD": 6, "document": 7, "line": 8, "statement": 9, "INVALID": 10, "box_section": 11, "box_line": 12, "participant_statement": 13, "create": 14, "box": 15, "restOfLine": 16, "end": 17, "signal": 18, "autonumber": 19, "NUM": 20, "off": 21, "activate": 22, "actor": 23, "deactivate": 24, "note_statement": 25, "links_statement": 26, "link_statement": 27, "properties_statement": 28, "details_statement": 29, "title": 30, "legacy_title": 31, "acc_title": 32, "acc_title_value": 33, "acc_descr": 34, "acc_descr_value": 35, "acc_descr_multiline_value": 36, "loop": 37, "rect": 38, "opt": 39, "alt": 40, "else_sections": 41, "par": 42, "par_sections": 43, "par_over": 44, "critical": 45, "option_sections": 46, "break": 47, "option": 48, "and": 49, "else": 50, "participant": 51, "AS": 52, "participant_actor": 53, "destroy": 54, "actor_with_config": 55, "note": 56, "placement": 57, "text2": 58, "over": 59, "actor_pair": 60, "links": 61, "link": 62, "properties": 63, "details": 64, "spaceList": 65, ",": 66, "left_of": 67, "right_of": 68, "signaltype": 69, "+": 70, "-": 71, "()": 72, "ACTOR": 73, "config_object": 74, "CONFIG_START": 75, "CONFIG_CONTENT": 76, "CONFIG_END": 77, "SOLID_OPEN_ARROW": 78, "DOTTED_OPEN_ARROW": 79, "SOLID_ARROW": 80, "SOLID_ARROW_TOP": 81, "SOLID_ARROW_BOTTOM": 82, "STICK_ARROW_TOP": 83, "STICK_ARROW_BOTTOM": 84, "SOLID_ARROW_TOP_DOTTED": 85, "SOLID_ARROW_BOTTOM_DOTTED": 86, "STICK_ARROW_TOP_DOTTED": 87, "STICK_ARROW_BOTTOM_DOTTED": 88, "SOLID_ARROW_TOP_REVERSE": 89, "SOLID_ARROW_BOTTOM_REVERSE": 90, "STICK_ARROW_TOP_REVERSE": 91, "STICK_ARROW_BOTTOM_REVERSE": 92, "SOLID_ARROW_TOP_REVERSE_DOTTED": 93, "SOLID_ARROW_BOTTOM_REVERSE_DOTTED": 94, "STICK_ARROW_TOP_REVERSE_DOTTED": 95, "STICK_ARROW_BOTTOM_REVERSE_DOTTED": 96, "BIDIRECTIONAL_SOLID_ARROW": 97, "DOTTED_ARROW": 98, "BIDIRECTIONAL_DOTTED_ARROW": 99, "SOLID_CROSS": 100, "DOTTED_CROSS": 101, "SOLID_POINT": 102, "DOTTED_POINT": 103, "TXT": 104, "$accept": 0, "$end": 1 },
    terminals_: { 2: "error", 4: "SPACE", 5: "NEWLINE", 6: "SD", 10: "INVALID", 14: "create", 15: "box", 16: "restOfLine", 17: "end", 19: "autonumber", 20: "NUM", 21: "off", 22: "activate", 24: "deactivate", 30: "title", 31: "legacy_title", 32: "acc_title", 33: "acc_title_value", 34: "acc_descr", 35: "acc_descr_value", 36: "acc_descr_multiline_value", 37: "loop", 38: "rect", 39: "opt", 40: "alt", 42: "par", 44: "par_over", 45: "critical", 47: "break", 48: "option", 49: "and", 50: "else", 51: "participant", 52: "AS", 53: "participant_actor", 54: "destroy", 56: "note", 59: "over", 61: "links", 62: "link", 63: "properties", 64: "details", 66: ",", 67: "left_of", 68: "right_of", 70: "+", 71: "-", 72: "()", 73: "ACTOR", 75: "CONFIG_START", 76: "CONFIG_CONTENT", 77: "CONFIG_END", 78: "SOLID_OPEN_ARROW", 79: "DOTTED_OPEN_ARROW", 80: "SOLID_ARROW", 81: "SOLID_ARROW_TOP", 82: "SOLID_ARROW_BOTTOM", 83: "STICK_ARROW_TOP", 84: "STICK_ARROW_BOTTOM", 85: "SOLID_ARROW_TOP_DOTTED", 86: "SOLID_ARROW_BOTTOM_DOTTED", 87: "STICK_ARROW_TOP_DOTTED", 88: "STICK_ARROW_BOTTOM_DOTTED", 89: "SOLID_ARROW_TOP_REVERSE", 90: "SOLID_ARROW_BOTTOM_REVERSE", 91: "STICK_ARROW_TOP_REVERSE", 92: "STICK_ARROW_BOTTOM_REVERSE", 93: "SOLID_ARROW_TOP_REVERSE_DOTTED", 94: "SOLID_ARROW_BOTTOM_REVERSE_DOTTED", 95: "STICK_ARROW_TOP_REVERSE_DOTTED", 96: "STICK_ARROW_BOTTOM_REVERSE_DOTTED", 97: "BIDIRECTIONAL_SOLID_ARROW", 98: "DOTTED_ARROW", 99: "BIDIRECTIONAL_DOTTED_ARROW", 100: "SOLID_CROSS", 101: "DOTTED_CROSS", 102: "SOLID_POINT", 103: "DOTTED_POINT", 104: "TXT" },
    productions_: [0, [3, 2], [3, 2], [3, 2], [7, 0], [7, 2], [8, 2], [8, 1], [8, 1], [8, 1], [11, 0], [11, 2], [12, 2], [12, 1], [12, 1], [9, 1], [9, 2], [9, 4], [9, 2], [9, 4], [9, 3], [9, 3], [9, 2], [9, 3], [9, 3], [9, 2], [9, 2], [9, 2], [9, 2], [9, 2], [9, 1], [9, 1], [9, 2], [9, 2], [9, 1], [9, 4], [9, 4], [9, 4], [9, 4], [9, 4], [9, 4], [9, 4], [9, 4], [46, 1], [46, 4], [43, 1], [43, 4], [41, 1], [41, 4], [13, 5], [13, 3], [13, 5], [13, 3], [13, 3], [13, 5], [13, 3], [13, 5], [13, 3], [25, 4], [25, 4], [26, 3], [27, 3], [28, 3], [29, 3], [65, 2], [65, 1], [60, 3], [60, 1], [57, 1], [57, 1], [18, 5], [18, 5], [18, 5], [18, 5], [18, 6], [18, 4], [55, 2], [74, 3], [23, 1], [23, 1], [69, 1], [69, 1], [69, 1], [69, 1], [69, 1], [69, 1], [69, 1], [69, 1], [69, 1], [69, 1], [69, 1], [69, 1], [69, 1], [69, 1], [69, 1], [69, 1], [69, 1], [69, 1], [69, 1], [69, 1], [69, 1], [69, 1], [69, 1], [69, 1], [69, 1], [69, 1], [58, 1]],
    performAction: /* @__PURE__ */ __name(function anonymous(yytext, yyleng, yylineno, yy, yystate, $$, _$) {
      var $0 = $$.length - 1;
      switch (yystate) {
        case 3:
          yy.apply($$[$0]);
          return $$[$0];
          break;
        case 4:
        case 10:
          this.$ = [];
          break;
        case 5:
        case 11:
          $$[$0 - 1].push($$[$0]);
          this.$ = $$[$0 - 1];
          break;
        case 6:
        case 7:
        case 12:
        case 13:
          this.$ = $$[$0];
          break;
        case 8:
        case 9:
        case 14:
          this.$ = [];
          break;
        case 16:
          $$[$0].type = "createParticipant";
          this.$ = $$[$0];
          break;
        case 17:
          $$[$0 - 1].unshift({ type: "boxStart", boxData: yy.parseBoxData($$[$0 - 2]) });
          $$[$0 - 1].push({ type: "boxEnd", boxText: $$[$0 - 2] });
          this.$ = $$[$0 - 1];
          break;
        case 19:
          this.$ = { type: "sequenceIndex", sequenceIndex: Number($$[$0 - 2]), sequenceIndexStep: Number($$[$0 - 1]), sequenceVisible: true, signalType: yy.LINETYPE.AUTONUMBER };
          break;
        case 20:
          this.$ = { type: "sequenceIndex", sequenceIndex: Number($$[$0 - 1]), sequenceIndexStep: 1, sequenceVisible: true, signalType: yy.LINETYPE.AUTONUMBER };
          break;
        case 21:
          this.$ = { type: "sequenceIndex", sequenceVisible: false, signalType: yy.LINETYPE.AUTONUMBER };
          break;
        case 22:
          this.$ = { type: "sequenceIndex", sequenceVisible: true, signalType: yy.LINETYPE.AUTONUMBER };
          break;
        case 23:
          this.$ = { type: "activeStart", signalType: yy.LINETYPE.ACTIVE_START, actor: $$[$0 - 1].actor };
          break;
        case 24:
          this.$ = { type: "activeEnd", signalType: yy.LINETYPE.ACTIVE_END, actor: $$[$0 - 1].actor };
          break;
        case 30:
          yy.setDiagramTitle($$[$0].substring(6));
          this.$ = $$[$0].substring(6);
          break;
        case 31:
          yy.setDiagramTitle($$[$0].substring(7));
          this.$ = $$[$0].substring(7);
          break;
        case 32:
          this.$ = $$[$0].trim();
          yy.setAccTitle(this.$);
          break;
        case 33:
        case 34:
          this.$ = $$[$0].trim();
          yy.setAccDescription(this.$);
          break;
        case 35:
          $$[$0 - 1].unshift({ type: "loopStart", loopText: yy.parseMessage($$[$0 - 2]), signalType: yy.LINETYPE.LOOP_START });
          $$[$0 - 1].push({ type: "loopEnd", loopText: $$[$0 - 2], signalType: yy.LINETYPE.LOOP_END });
          this.$ = $$[$0 - 1];
          break;
        case 36:
          $$[$0 - 1].unshift({ type: "rectStart", color: yy.parseMessage($$[$0 - 2]), signalType: yy.LINETYPE.RECT_START });
          $$[$0 - 1].push({ type: "rectEnd", color: yy.parseMessage($$[$0 - 2]), signalType: yy.LINETYPE.RECT_END });
          this.$ = $$[$0 - 1];
          break;
        case 37:
          $$[$0 - 1].unshift({ type: "optStart", optText: yy.parseMessage($$[$0 - 2]), signalType: yy.LINETYPE.OPT_START });
          $$[$0 - 1].push({ type: "optEnd", optText: yy.parseMessage($$[$0 - 2]), signalType: yy.LINETYPE.OPT_END });
          this.$ = $$[$0 - 1];
          break;
        case 38:
          $$[$0 - 1].unshift({ type: "altStart", altText: yy.parseMessage($$[$0 - 2]), signalType: yy.LINETYPE.ALT_START });
          $$[$0 - 1].push({ type: "altEnd", signalType: yy.LINETYPE.ALT_END });
          this.$ = $$[$0 - 1];
          break;
        case 39:
          $$[$0 - 1].unshift({ type: "parStart", parText: yy.parseMessage($$[$0 - 2]), signalType: yy.LINETYPE.PAR_START });
          $$[$0 - 1].push({ type: "parEnd", signalType: yy.LINETYPE.PAR_END });
          this.$ = $$[$0 - 1];
          break;
        case 40:
          $$[$0 - 1].unshift({ type: "parStart", parText: yy.parseMessage($$[$0 - 2]), signalType: yy.LINETYPE.PAR_OVER_START });
          $$[$0 - 1].push({ type: "parEnd", signalType: yy.LINETYPE.PAR_END });
          this.$ = $$[$0 - 1];
          break;
        case 41:
          $$[$0 - 1].unshift({ type: "criticalStart", criticalText: yy.parseMessage($$[$0 - 2]), signalType: yy.LINETYPE.CRITICAL_START });
          $$[$0 - 1].push({ type: "criticalEnd", signalType: yy.LINETYPE.CRITICAL_END });
          this.$ = $$[$0 - 1];
          break;
        case 42:
          $$[$0 - 1].unshift({ type: "breakStart", breakText: yy.parseMessage($$[$0 - 2]), signalType: yy.LINETYPE.BREAK_START });
          $$[$0 - 1].push({ type: "breakEnd", optText: yy.parseMessage($$[$0 - 2]), signalType: yy.LINETYPE.BREAK_END });
          this.$ = $$[$0 - 1];
          break;
        case 44:
          this.$ = $$[$0 - 3].concat([{ type: "option", optionText: yy.parseMessage($$[$0 - 1]), signalType: yy.LINETYPE.CRITICAL_OPTION }, $$[$0]]);
          break;
        case 46:
          this.$ = $$[$0 - 3].concat([{ type: "and", parText: yy.parseMessage($$[$0 - 1]), signalType: yy.LINETYPE.PAR_AND }, $$[$0]]);
          break;
        case 48:
          this.$ = $$[$0 - 3].concat([{ type: "else", altText: yy.parseMessage($$[$0 - 1]), signalType: yy.LINETYPE.ALT_ELSE }, $$[$0]]);
          break;
        case 49:
          $$[$0 - 3].draw = "participant";
          $$[$0 - 3].type = "addParticipant";
          $$[$0 - 3].description = yy.parseMessage($$[$0 - 1]);
          this.$ = $$[$0 - 3];
          break;
        case 50:
          $$[$0 - 1].draw = "participant";
          $$[$0 - 1].type = "addParticipant";
          this.$ = $$[$0 - 1];
          break;
        case 51:
          $$[$0 - 3].draw = "actor";
          $$[$0 - 3].type = "addParticipant";
          $$[$0 - 3].description = yy.parseMessage($$[$0 - 1]);
          this.$ = $$[$0 - 3];
          break;
        case 52:
        case 57:
          $$[$0 - 1].draw = "actor";
          $$[$0 - 1].type = "addParticipant";
          this.$ = $$[$0 - 1];
          break;
        case 53:
          $$[$0 - 1].type = "destroyParticipant";
          this.$ = $$[$0 - 1];
          break;
        case 54:
          $$[$0 - 3].draw = "participant";
          $$[$0 - 3].type = "addParticipant";
          $$[$0 - 3].description = yy.parseMessage($$[$0 - 1]);
          this.$ = $$[$0 - 3];
          break;
        case 55:
          $$[$0 - 1].draw = "participant";
          $$[$0 - 1].type = "addParticipant";
          this.$ = $$[$0 - 1];
          break;
        case 56:
          $$[$0 - 3].draw = "actor";
          $$[$0 - 3].type = "addParticipant";
          $$[$0 - 3].description = yy.parseMessage($$[$0 - 1]);
          this.$ = $$[$0 - 3];
          break;
        case 58:
          this.$ = [$$[$0 - 1], { type: "addNote", placement: $$[$0 - 2], actor: $$[$0 - 1].actor, text: $$[$0] }];
          break;
        case 59:
          $$[$0 - 2] = [].concat($$[$0 - 1], $$[$0 - 1]).slice(0, 2);
          $$[$0 - 2][0] = $$[$0 - 2][0].actor;
          $$[$0 - 2][1] = $$[$0 - 2][1].actor;
          this.$ = [$$[$0 - 1], { type: "addNote", placement: yy.PLACEMENT.OVER, actor: $$[$0 - 2].slice(0, 2), text: $$[$0] }];
          break;
        case 60:
          this.$ = [$$[$0 - 1], { type: "addLinks", actor: $$[$0 - 1].actor, text: $$[$0] }];
          break;
        case 61:
          this.$ = [$$[$0 - 1], { type: "addALink", actor: $$[$0 - 1].actor, text: $$[$0] }];
          break;
        case 62:
          this.$ = [$$[$0 - 1], { type: "addProperties", actor: $$[$0 - 1].actor, text: $$[$0] }];
          break;
        case 63:
          this.$ = [$$[$0 - 1], { type: "addDetails", actor: $$[$0 - 1].actor, text: $$[$0] }];
          break;
        case 66:
          this.$ = [$$[$0 - 2], $$[$0]];
          break;
        case 67:
          this.$ = $$[$0];
          break;
        case 68:
          this.$ = yy.PLACEMENT.LEFTOF;
          break;
        case 69:
          this.$ = yy.PLACEMENT.RIGHTOF;
          break;
        case 70:
          this.$ = [
            $$[$0 - 4],
            $$[$0 - 1],
            { type: "addMessage", from: $$[$0 - 4].actor, to: $$[$0 - 1].actor, signalType: $$[$0 - 3], msg: $$[$0], activate: true },
            { type: "activeStart", signalType: yy.LINETYPE.ACTIVE_START, actor: $$[$0 - 1].actor }
          ];
          break;
        case 71:
          this.$ = [
            $$[$0 - 4],
            $$[$0 - 1],
            { type: "addMessage", from: $$[$0 - 4].actor, to: $$[$0 - 1].actor, signalType: $$[$0 - 3], msg: $$[$0] },
            { type: "activeEnd", signalType: yy.LINETYPE.ACTIVE_END, actor: $$[$0 - 4].actor }
          ];
          break;
        case 72:
          this.$ = [
            $$[$0 - 4],
            $$[$0 - 1],
            { type: "addMessage", from: $$[$0 - 4].actor, to: $$[$0 - 1].actor, signalType: $$[$0 - 3], msg: $$[$0], activate: true, centralConnection: yy.LINETYPE.CENTRAL_CONNECTION },
            { type: "centralConnection", signalType: yy.LINETYPE.CENTRAL_CONNECTION, actor: $$[$0 - 1].actor }
          ];
          break;
        case 73:
          this.$ = [
            $$[$0 - 4],
            $$[$0 - 1],
            { type: "addMessage", from: $$[$0 - 4].actor, to: $$[$0 - 1].actor, signalType: $$[$0 - 2], msg: $$[$0], activate: false, centralConnection: yy.LINETYPE.CENTRAL_CONNECTION_REVERSE },
            { type: "centralConnectionReverse", signalType: yy.LINETYPE.CENTRAL_CONNECTION_REVERSE, actor: $$[$0 - 4].actor }
          ];
          break;
        case 74:
          this.$ = [
            $$[$0 - 5],
            $$[$0 - 1],
            { type: "addMessage", from: $$[$0 - 5].actor, to: $$[$0 - 1].actor, signalType: $$[$0 - 3], msg: $$[$0], activate: true, centralConnection: yy.LINETYPE.CENTRAL_CONNECTION_DUAL },
            { type: "centralConnection", signalType: yy.LINETYPE.CENTRAL_CONNECTION, actor: $$[$0 - 1].actor },
            { type: "centralConnectionReverse", signalType: yy.LINETYPE.CENTRAL_CONNECTION_REVERSE, actor: $$[$0 - 5].actor }
          ];
          break;
        case 75:
          this.$ = [$$[$0 - 3], $$[$0 - 1], { type: "addMessage", from: $$[$0 - 3].actor, to: $$[$0 - 1].actor, signalType: $$[$0 - 2], msg: $$[$0] }];
          break;
        case 76:
          this.$ = {
            type: "addParticipant",
            actor: $$[$0 - 1],
            config: $$[$0]
          };
          break;
        case 77:
          this.$ = $$[$0 - 1].trim();
          break;
        case 78:
        case 79:
          this.$ = { type: "addParticipant", actor: $$[$0] };
          break;
        case 80:
          this.$ = yy.LINETYPE.SOLID_OPEN;
          break;
        case 81:
          this.$ = yy.LINETYPE.DOTTED_OPEN;
          break;
        case 82:
          this.$ = yy.LINETYPE.SOLID;
          break;
        case 83:
          this.$ = yy.LINETYPE.SOLID_TOP;
          break;
        case 84:
          this.$ = yy.LINETYPE.SOLID_BOTTOM;
          break;
        case 85:
          this.$ = yy.LINETYPE.STICK_TOP;
          break;
        case 86:
          this.$ = yy.LINETYPE.STICK_BOTTOM;
          break;
        case 87:
          this.$ = yy.LINETYPE.SOLID_TOP_DOTTED;
          break;
        case 88:
          this.$ = yy.LINETYPE.SOLID_BOTTOM_DOTTED;
          break;
        case 89:
          this.$ = yy.LINETYPE.STICK_TOP_DOTTED;
          break;
        case 90:
          this.$ = yy.LINETYPE.STICK_BOTTOM_DOTTED;
          break;
        case 91:
          this.$ = yy.LINETYPE.SOLID_ARROW_TOP_REVERSE;
          break;
        case 92:
          this.$ = yy.LINETYPE.SOLID_ARROW_BOTTOM_REVERSE;
          break;
        case 93:
          this.$ = yy.LINETYPE.STICK_ARROW_TOP_REVERSE;
          break;
        case 94:
          this.$ = yy.LINETYPE.STICK_ARROW_BOTTOM_REVERSE;
          break;
        case 95:
          this.$ = yy.LINETYPE.SOLID_ARROW_TOP_REVERSE_DOTTED;
          break;
        case 96:
          this.$ = yy.LINETYPE.SOLID_ARROW_BOTTOM_REVERSE_DOTTED;
          break;
        case 97:
          this.$ = yy.LINETYPE.STICK_ARROW_TOP_REVERSE_DOTTED;
          break;
        case 98:
          this.$ = yy.LINETYPE.STICK_ARROW_BOTTOM_REVERSE_DOTTED;
          break;
        case 99:
          this.$ = yy.LINETYPE.BIDIRECTIONAL_SOLID;
          break;
        case 100:
          this.$ = yy.LINETYPE.DOTTED;
          break;
        case 101:
          this.$ = yy.LINETYPE.BIDIRECTIONAL_DOTTED;
          break;
        case 102:
          this.$ = yy.LINETYPE.SOLID_CROSS;
          break;
        case 103:
          this.$ = yy.LINETYPE.DOTTED_CROSS;
          break;
        case 104:
          this.$ = yy.LINETYPE.SOLID_POINT;
          break;
        case 105:
          this.$ = yy.LINETYPE.DOTTED_POINT;
          break;
        case 106:
          this.$ = yy.parseMessage($$[$0].trim().substring(1));
          break;
      }
    }, "anonymous"),
    table: [{ 3: 1, 4: $V0, 5: $V1, 6: $V2 }, { 1: [3] }, { 3: 5, 4: $V0, 5: $V1, 6: $V2 }, { 3: 6, 4: $V0, 5: $V1, 6: $V2 }, o([1, 4, 5, 10, 14, 15, 19, 22, 24, 30, 31, 32, 34, 36, 37, 38, 39, 40, 42, 44, 45, 47, 51, 53, 54, 56, 61, 62, 63, 64, 73], $V3, { 7: 7 }), { 1: [2, 1] }, { 1: [2, 2] }, { 1: [2, 3], 4: $V4, 5: $V5, 8: 8, 9: 10, 10: $V6, 13: 13, 14: $V7, 15: $V8, 18: 16, 19: $V9, 22: $Va, 23: 41, 24: $Vb, 25: 20, 26: 21, 27: 22, 28: 23, 29: 24, 30: $Vc, 31: $Vd, 32: $Ve, 34: $Vf, 36: $Vg, 37: $Vh, 38: $Vi, 39: $Vj, 40: $Vk, 42: $Vl, 44: $Vm, 45: $Vn, 47: $Vo, 51: $Vp, 53: $Vq, 54: $Vr, 56: $Vs, 61: $Vt, 62: $Vu, 63: $Vv, 64: $Vw, 73: $Vx }, o($Vy, [2, 5]), { 9: 48, 13: 13, 14: $V7, 15: $V8, 18: 16, 19: $V9, 22: $Va, 23: 41, 24: $Vb, 25: 20, 26: 21, 27: 22, 28: 23, 29: 24, 30: $Vc, 31: $Vd, 32: $Ve, 34: $Vf, 36: $Vg, 37: $Vh, 38: $Vi, 39: $Vj, 40: $Vk, 42: $Vl, 44: $Vm, 45: $Vn, 47: $Vo, 51: $Vp, 53: $Vq, 54: $Vr, 56: $Vs, 61: $Vt, 62: $Vu, 63: $Vv, 64: $Vw, 73: $Vx }, o($Vy, [2, 7]), o($Vy, [2, 8]), o($Vy, [2, 9]), o($Vy, [2, 15]), { 13: 49, 51: $Vp, 53: $Vq, 54: $Vr }, { 16: [1, 50] }, { 5: [1, 51] }, { 5: [1, 54], 20: [1, 52], 21: [1, 53] }, { 23: 55, 62: $Vz, 73: $Vx }, { 23: 57, 62: $Vz, 73: $Vx }, { 5: [1, 58] }, { 5: [1, 59] }, { 5: [1, 60] }, { 5: [1, 61] }, { 5: [1, 62] }, o($Vy, [2, 30]), o($Vy, [2, 31]), { 33: [1, 63] }, { 35: [1, 64] }, o($Vy, [2, 34]), { 16: [1, 65] }, { 16: [1, 66] }, { 16: [1, 67] }, { 16: [1, 68] }, { 16: [1, 69] }, { 16: [1, 70] }, { 16: [1, 71] }, { 16: [1, 72] }, { 23: 73, 55: 74, 62: $Vz, 73: $VA }, { 23: 76, 55: 77, 62: $Vz, 73: $VA }, { 23: 78, 62: $Vz, 73: $Vx }, { 69: 79, 72: [1, 80], 78: $VB, 79: $VC, 80: $VD, 81: $VE, 82: $VF, 83: $VG, 84: $VH, 85: $VI, 86: $VJ, 87: $VK, 88: $VL, 89: $VM, 90: $VN, 91: $VO, 92: $VP, 93: $VQ, 94: $VR, 95: $VS, 96: $VT, 97: $VU, 98: $VV, 99: $VW, 100: $VX, 101: $VY, 102: $VZ, 103: $V_ }, { 57: 107, 59: [1, 108], 67: [1, 109], 68: [1, 110] }, { 23: 111, 62: $Vz, 73: $Vx }, o([72, 78, 79, 80, 81, 82, 83, 84, 85, 86, 87, 88, 89, 90, 91, 92, 93, 94, 95, 96, 97, 98, 99, 100, 101, 102, 103], $V$, { 23: 112, 62: $Vz, 73: $Vx }), { 23: 113, 62: $Vz, 73: $Vx }, { 23: 114, 62: $Vz, 73: $Vx }, o([5, 66, 72, 78, 79, 80, 81, 82, 83, 84, 85, 86, 87, 88, 89, 90, 91, 92, 93, 94, 95, 96, 97, 98, 99, 100, 101, 102, 103, 104], $V01), o($Vy, [2, 6]), o($Vy, [2, 16]), o($V11, [2, 10], { 11: 115 }), o($Vy, [2, 18]), { 5: [1, 117], 20: [1, 116] }, { 5: [1, 118] }, o($Vy, [2, 22]), { 5: [1, 119] }, o([5, 52, 66, 104], $V$), { 5: [1, 120] }, o($Vy, [2, 25]), o($Vy, [2, 26]), o($Vy, [2, 27]), o($Vy, [2, 28]), o($Vy, [2, 29]), o($Vy, [2, 32]), o($Vy, [2, 33]), o($V21, $V3, { 7: 121 }), o($V21, $V3, { 7: 122 }), o($V21, $V3, { 7: 123 }), o($V31, $V3, { 41: 124, 7: 125 }), o($V41, $V3, { 43: 126, 7: 127 }), o($V41, $V3, { 7: 127, 43: 128 }), o($V51, $V3, { 46: 129, 7: 130 }), o($V21, $V3, { 7: 131 }), { 5: [1, 133], 52: [1, 132] }, { 5: [1, 135], 52: [1, 134] }, o($V61, $V01, { 74: 136, 75: [1, 137] }), { 5: [1, 139], 52: [1, 138] }, { 5: [1, 141], 52: [1, 140] }, { 5: [1, 142] }, { 23: 146, 62: $Vz, 70: [1, 143], 71: [1, 144], 72: [1, 145], 73: $Vx }, { 69: 147, 78: $VB, 79: $VC, 80: $VD, 81: $VE, 82: $VF, 83: $VG, 84: $VH, 85: $VI, 86: $VJ, 87: $VK, 88: $VL, 89: $VM, 90: $VN, 91: $VO, 92: $VP, 93: $VQ, 94: $VR, 95: $VS, 96: $VT, 97: $VU, 98: $VV, 99: $VW, 100: $VX, 101: $VY, 102: $VZ, 103: $V_ }, o($V71, [2, 80]), o($V71, [2, 81]), o($V71, [2, 82]), o($V71, [2, 83]), o($V71, [2, 84]), o($V71, [2, 85]), o($V71, [2, 86]), o($V71, [2, 87]), o($V71, [2, 88]), o($V71, [2, 89]), o($V71, [2, 90]), o($V71, [2, 91]), o($V71, [2, 92]), o($V71, [2, 93]), o($V71, [2, 94]), o($V71, [2, 95]), o($V71, [2, 96]), o($V71, [2, 97]), o($V71, [2, 98]), o($V71, [2, 99]), o($V71, [2, 100]), o($V71, [2, 101]), o($V71, [2, 102]), o($V71, [2, 103]), o($V71, [2, 104]), o($V71, [2, 105]), { 23: 148, 62: $Vz, 73: $Vx }, { 23: 150, 60: 149, 62: $Vz, 73: $Vx }, o($V81, [2, 68]), o($V81, [2, 69]), { 58: 151, 104: $V91 }, { 58: 153, 104: $V91 }, { 58: 154, 104: $V91 }, { 58: 155, 104: $V91 }, { 4: [1, 158], 5: [1, 160], 12: 157, 13: 159, 17: [1, 156], 51: $Vp, 53: $Vq, 54: $Vr }, { 5: [1, 161] }, o($Vy, [2, 20]), o($Vy, [2, 21]), o($Vy, [2, 23]), o($Vy, [2, 24]), { 4: $V4, 5: $V5, 8: 8, 9: 10, 10: $V6, 13: 13, 14: $V7, 15: $V8, 17: [1, 162], 18: 16, 19: $V9, 22: $Va, 23: 41, 24: $Vb, 25: 20, 26: 21, 27: 22, 28: 23, 29: 24, 30: $Vc, 31: $Vd, 32: $Ve, 34: $Vf, 36: $Vg, 37: $Vh, 38: $Vi, 39: $Vj, 40: $Vk, 42: $Vl, 44: $Vm, 45: $Vn, 47: $Vo, 51: $Vp, 53: $Vq, 54: $Vr, 56: $Vs, 61: $Vt, 62: $Vu, 63: $Vv, 64: $Vw, 73: $Vx }, { 4: $V4, 5: $V5, 8: 8, 9: 10, 10: $V6, 13: 13, 14: $V7, 15: $V8, 17: [1, 163], 18: 16, 19: $V9, 22: $Va, 23: 41, 24: $Vb, 25: 20, 26: 21, 27: 22, 28: 23, 29: 24, 30: $Vc, 31: $Vd, 32: $Ve, 34: $Vf, 36: $Vg, 37: $Vh, 38: $Vi, 39: $Vj, 40: $Vk, 42: $Vl, 44: $Vm, 45: $Vn, 47: $Vo, 51: $Vp, 53: $Vq, 54: $Vr, 56: $Vs, 61: $Vt, 62: $Vu, 63: $Vv, 64: $Vw, 73: $Vx }, { 4: $V4, 5: $V5, 8: 8, 9: 10, 10: $V6, 13: 13, 14: $V7, 15: $V8, 17: [1, 164], 18: 16, 19: $V9, 22: $Va, 23: 41, 24: $Vb, 25: 20, 26: 21, 27: 22, 28: 23, 29: 24, 30: $Vc, 31: $Vd, 32: $Ve, 34: $Vf, 36: $Vg, 37: $Vh, 38: $Vi, 39: $Vj, 40: $Vk, 42: $Vl, 44: $Vm, 45: $Vn, 47: $Vo, 51: $Vp, 53: $Vq, 54: $Vr, 56: $Vs, 61: $Vt, 62: $Vu, 63: $Vv, 64: $Vw, 73: $Vx }, { 17: [1, 165] }, { 4: $V4, 5: $V5, 8: 8, 9: 10, 10: $V6, 13: 13, 14: $V7, 15: $V8, 17: [2, 47], 18: 16, 19: $V9, 22: $Va, 23: 41, 24: $Vb, 25: 20, 26: 21, 27: 22, 28: 23, 29: 24, 30: $Vc, 31: $Vd, 32: $Ve, 34: $Vf, 36: $Vg, 37: $Vh, 38: $Vi, 39: $Vj, 40: $Vk, 42: $Vl, 44: $Vm, 45: $Vn, 47: $Vo, 50: [1, 166], 51: $Vp, 53: $Vq, 54: $Vr, 56: $Vs, 61: $Vt, 62: $Vu, 63: $Vv, 64: $Vw, 73: $Vx }, { 17: [1, 167] }, { 4: $V4, 5: $V5, 8: 8, 9: 10, 10: $V6, 13: 13, 14: $V7, 15: $V8, 17: [2, 45], 18: 16, 19: $V9, 22: $Va, 23: 41, 24: $Vb, 25: 20, 26: 21, 27: 22, 28: 23, 29: 24, 30: $Vc, 31: $Vd, 32: $Ve, 34: $Vf, 36: $Vg, 37: $Vh, 38: $Vi, 39: $Vj, 40: $Vk, 42: $Vl, 44: $Vm, 45: $Vn, 47: $Vo, 49: [1, 168], 51: $Vp, 53: $Vq, 54: $Vr, 56: $Vs, 61: $Vt, 62: $Vu, 63: $Vv, 64: $Vw, 73: $Vx }, { 17: [1, 169] }, { 17: [1, 170] }, { 4: $V4, 5: $V5, 8: 8, 9: 10, 10: $V6, 13: 13, 14: $V7, 15: $V8, 17: [2, 43], 18: 16, 19: $V9, 22: $Va, 23: 41, 24: $Vb, 25: 20, 26: 21, 27: 22, 28: 23, 29: 24, 30: $Vc, 31: $Vd, 32: $Ve, 34: $Vf, 36: $Vg, 37: $Vh, 38: $Vi, 39: $Vj, 40: $Vk, 42: $Vl, 44: $Vm, 45: $Vn, 47: $Vo, 48: [1, 171], 51: $Vp, 53: $Vq, 54: $Vr, 56: $Vs, 61: $Vt, 62: $Vu, 63: $Vv, 64: $Vw, 73: $Vx }, { 4: $V4, 5: $V5, 8: 8, 9: 10, 10: $V6, 13: 13, 14: $V7, 15: $V8, 17: [1, 172], 18: 16, 19: $V9, 22: $Va, 23: 41, 24: $Vb, 25: 20, 26: 21, 27: 22, 28: 23, 29: 24, 30: $Vc, 31: $Vd, 32: $Ve, 34: $Vf, 36: $Vg, 37: $Vh, 38: $Vi, 39: $Vj, 40: $Vk, 42: $Vl, 44: $Vm, 45: $Vn, 47: $Vo, 51: $Vp, 53: $Vq, 54: $Vr, 56: $Vs, 61: $Vt, 62: $Vu, 63: $Vv, 64: $Vw, 73: $Vx }, { 16: [1, 173] }, o($Vy, [2, 50]), { 16: [1, 174] }, o($Vy, [2, 55]), o($V61, [2, 76]), { 76: [1, 175] }, { 16: [1, 176] }, o($Vy, [2, 52]), { 16: [1, 177] }, o($Vy, [2, 57]), o($Vy, [2, 53]), { 23: 178, 62: $Vz, 73: $Vx }, { 23: 179, 62: $Vz, 73: $Vx }, { 23: 180, 62: $Vz, 73: $Vx }, { 58: 181, 104: $V91 }, { 23: 182, 62: $Vz, 72: [1, 183], 73: $Vx }, { 58: 184, 104: $V91 }, { 58: 185, 104: $V91 }, { 66: [1, 186], 104: [2, 67] }, { 5: [2, 60] }, { 5: [2, 106] }, { 5: [2, 61] }, { 5: [2, 62] }, { 5: [2, 63] }, o($Vy, [2, 17]), o($V11, [2, 11]), { 13: 187, 51: $Vp, 53: $Vq, 54: $Vr }, o($V11, [2, 13]), o($V11, [2, 14]), o($Vy, [2, 19]), o($Vy, [2, 35]), o($Vy, [2, 36]), o($Vy, [2, 37]), o($Vy, [2, 38]), { 16: [1, 188] }, o($Vy, [2, 39]), { 16: [1, 189] }, o($Vy, [2, 40]), o($Vy, [2, 41]), { 16: [1, 190] }, o($Vy, [2, 42]), { 5: [1, 191] }, { 5: [1, 192] }, { 77: [1, 193] }, { 5: [1, 194] }, { 5: [1, 195] }, { 58: 196, 104: $V91 }, { 58: 197, 104: $V91 }, { 58: 198, 104: $V91 }, { 5: [2, 75] }, { 58: 199, 104: $V91 }, { 23: 200, 62: $Vz, 73: $Vx }, { 5: [2, 58] }, { 5: [2, 59] }, { 23: 201, 62: $Vz, 73: $Vx }, o($V11, [2, 12]), o($V31, $V3, { 7: 125, 41: 202 }), o($V41, $V3, { 7: 127, 43: 203 }), o($V51, $V3, { 7: 130, 46: 204 }), o($Vy, [2, 49]), o($Vy, [2, 54]), o($V61, [2, 77]), o($Vy, [2, 51]), o($Vy, [2, 56]), { 5: [2, 70] }, { 5: [2, 71] }, { 5: [2, 72] }, { 5: [2, 73] }, { 58: 205, 104: $V91 }, { 104: [2, 66] }, { 17: [2, 48] }, { 17: [2, 46] }, { 17: [2, 44] }, { 5: [2, 74] }],
    defaultActions: { 5: [2, 1], 6: [2, 2], 151: [2, 60], 152: [2, 106], 153: [2, 61], 154: [2, 62], 155: [2, 63], 181: [2, 75], 184: [2, 58], 185: [2, 59], 196: [2, 70], 197: [2, 71], 198: [2, 72], 199: [2, 73], 201: [2, 66], 202: [2, 48], 203: [2, 46], 204: [2, 44], 205: [2, 74] },
    parseError: /* @__PURE__ */ __name(function parseError(str, hash) {
      if (hash.recoverable) {
        this.trace(str);
      } else {
        var error = new Error(str);
        error.hash = hash;
        throw error;
      }
    }, "parseError"),
    parse: /* @__PURE__ */ __name(function parse(input) {
      var self = this, stack = [0], tstack = [], vstack = [null], lstack = [], table = this.table, yytext = "", yylineno = 0, yyleng = 0, recovering = 0, TERROR = 2, EOF = 1;
      var args = lstack.slice.call(arguments, 1);
      var lexer2 = Object.create(this.lexer);
      var sharedState = { yy: {} };
      for (var k in this.yy) {
        if (Object.prototype.hasOwnProperty.call(this.yy, k)) {
          sharedState.yy[k] = this.yy[k];
        }
      }
      lexer2.setInput(input, sharedState.yy);
      sharedState.yy.lexer = lexer2;
      sharedState.yy.parser = this;
      if (typeof lexer2.yylloc == "undefined") {
        lexer2.yylloc = {};
      }
      var yyloc = lexer2.yylloc;
      lstack.push(yyloc);
      var ranges = lexer2.options && lexer2.options.ranges;
      if (typeof sharedState.yy.parseError === "function") {
        this.parseError = sharedState.yy.parseError;
      } else {
        this.parseError = Object.getPrototypeOf(this).parseError;
      }
      function popStack(n) {
        stack.length = stack.length - 2 * n;
        vstack.length = vstack.length - n;
        lstack.length = lstack.length - n;
      }
      __name(popStack, "popStack");
      function lex() {
        var token;
        token = tstack.pop() || lexer2.lex() || EOF;
        if (typeof token !== "number") {
          if (token instanceof Array) {
            tstack = token;
            token = tstack.pop();
          }
          token = self.symbols_[token] || token;
        }
        return token;
      }
      __name(lex, "lex");
      var symbol, preErrorSymbol, state, action, a, r, yyval = {}, p, len, newState, expected;
      while (true) {
        state = stack[stack.length - 1];
        if (this.defaultActions[state]) {
          action = this.defaultActions[state];
        } else {
          if (symbol === null || typeof symbol == "undefined") {
            symbol = lex();
          }
          action = table[state] && table[state][symbol];
        }
        if (typeof action === "undefined" || !action.length || !action[0]) {
          var errStr = "";
          expected = [];
          for (p in table[state]) {
            if (this.terminals_[p] && p > TERROR) {
              expected.push("'" + this.terminals_[p] + "'");
            }
          }
          if (lexer2.showPosition) {
            errStr = "Parse error on line " + (yylineno + 1) + ":\n" + lexer2.showPosition() + "\nExpecting " + expected.join(", ") + ", got '" + (this.terminals_[symbol] || symbol) + "'";
          } else {
            errStr = "Parse error on line " + (yylineno + 1) + ": Unexpected " + (symbol == EOF ? "end of input" : "'" + (this.terminals_[symbol] || symbol) + "'");
          }
          this.parseError(errStr, {
            text: lexer2.match,
            token: this.terminals_[symbol] || symbol,
            line: lexer2.yylineno,
            loc: yyloc,
            expected
          });
        }
        if (action[0] instanceof Array && action.length > 1) {
          throw new Error("Parse Error: multiple actions possible at state: " + state + ", token: " + symbol);
        }
        switch (action[0]) {
          case 1:
            stack.push(symbol);
            vstack.push(lexer2.yytext);
            lstack.push(lexer2.yylloc);
            stack.push(action[1]);
            symbol = null;
            if (!preErrorSymbol) {
              yyleng = lexer2.yyleng;
              yytext = lexer2.yytext;
              yylineno = lexer2.yylineno;
              yyloc = lexer2.yylloc;
              if (recovering > 0) {
                recovering--;
              }
            } else {
              symbol = preErrorSymbol;
              preErrorSymbol = null;
            }
            break;
          case 2:
            len = this.productions_[action[1]][1];
            yyval.$ = vstack[vstack.length - len];
            yyval._$ = {
              first_line: lstack[lstack.length - (len || 1)].first_line,
              last_line: lstack[lstack.length - 1].last_line,
              first_column: lstack[lstack.length - (len || 1)].first_column,
              last_column: lstack[lstack.length - 1].last_column
            };
            if (ranges) {
              yyval._$.range = [
                lstack[lstack.length - (len || 1)].range[0],
                lstack[lstack.length - 1].range[1]
              ];
            }
            r = this.performAction.apply(yyval, [
              yytext,
              yyleng,
              yylineno,
              sharedState.yy,
              action[1],
              vstack,
              lstack
            ].concat(args));
            if (typeof r !== "undefined") {
              return r;
            }
            if (len) {
              stack = stack.slice(0, -1 * len * 2);
              vstack = vstack.slice(0, -1 * len);
              lstack = lstack.slice(0, -1 * len);
            }
            stack.push(this.productions_[action[1]][0]);
            vstack.push(yyval.$);
            lstack.push(yyval._$);
            newState = table[stack[stack.length - 2]][stack[stack.length - 1]];
            stack.push(newState);
            break;
          case 3:
            return true;
        }
      }
      return true;
    }, "parse")
  };
  var lexer = /* @__PURE__ */ (function() {
    var lexer2 = {
      EOF: 1,
      parseError: /* @__PURE__ */ __name(function parseError(str, hash) {
        if (this.yy.parser) {
          this.yy.parser.parseError(str, hash);
        } else {
          throw new Error(str);
        }
      }, "parseError"),
      // resets the lexer, sets new input
      setInput: /* @__PURE__ */ __name(function(input, yy) {
        this.yy = yy || this.yy || {};
        this._input = input;
        this._more = this._backtrack = this.done = false;
        this.yylineno = this.yyleng = 0;
        this.yytext = this.matched = this.match = "";
        this.conditionStack = ["INITIAL"];
        this.yylloc = {
          first_line: 1,
          first_column: 0,
          last_line: 1,
          last_column: 0
        };
        if (this.options.ranges) {
          this.yylloc.range = [0, 0];
        }
        this.offset = 0;
        return this;
      }, "setInput"),
      // consumes and returns one char from the input
      input: /* @__PURE__ */ __name(function() {
        var ch = this._input[0];
        this.yytext += ch;
        this.yyleng++;
        this.offset++;
        this.match += ch;
        this.matched += ch;
        var lines = ch.match(/(?:\r\n?|\n).*/g);
        if (lines) {
          this.yylineno++;
          this.yylloc.last_line++;
        } else {
          this.yylloc.last_column++;
        }
        if (this.options.ranges) {
          this.yylloc.range[1]++;
        }
        this._input = this._input.slice(1);
        return ch;
      }, "input"),
      // unshifts one char (or a string) into the input
      unput: /* @__PURE__ */ __name(function(ch) {
        var len = ch.length;
        var lines = ch.split(/(?:\r\n?|\n)/g);
        this._input = ch + this._input;
        this.yytext = this.yytext.substr(0, this.yytext.length - len);
        this.offset -= len;
        var oldLines = this.match.split(/(?:\r\n?|\n)/g);
        this.match = this.match.substr(0, this.match.length - 1);
        this.matched = this.matched.substr(0, this.matched.length - 1);
        if (lines.length - 1) {
          this.yylineno -= lines.length - 1;
        }
        var r = this.yylloc.range;
        this.yylloc = {
          first_line: this.yylloc.first_line,
          last_line: this.yylineno + 1,
          first_column: this.yylloc.first_column,
          last_column: lines ? (lines.length === oldLines.length ? this.yylloc.first_column : 0) + oldLines[oldLines.length - lines.length].length - lines[0].length : this.yylloc.first_column - len
        };
        if (this.options.ranges) {
          this.yylloc.range = [r[0], r[0] + this.yyleng - len];
        }
        this.yyleng = this.yytext.length;
        return this;
      }, "unput"),
      // When called from action, caches matched text and appends it on next action
      more: /* @__PURE__ */ __name(function() {
        this._more = true;
        return this;
      }, "more"),
      // When called from action, signals the lexer that this rule fails to match the input, so the next matching rule (regex) should be tested instead.
      reject: /* @__PURE__ */ __name(function() {
        if (this.options.backtrack_lexer) {
          this._backtrack = true;
        } else {
          return this.parseError("Lexical error on line " + (this.yylineno + 1) + ". You can only invoke reject() in the lexer when the lexer is of the backtracking persuasion (options.backtrack_lexer = true).\n" + this.showPosition(), {
            text: "",
            token: null,
            line: this.yylineno
          });
        }
        return this;
      }, "reject"),
      // retain first n characters of the match
      less: /* @__PURE__ */ __name(function(n) {
        this.unput(this.match.slice(n));
      }, "less"),
      // displays already matched input, i.e. for error messages
      pastInput: /* @__PURE__ */ __name(function() {
        var past = this.matched.substr(0, this.matched.length - this.match.length);
        return (past.length > 20 ? "..." : "") + past.substr(-20).replace(/\n/g, "");
      }, "pastInput"),
      // displays upcoming input, i.e. for error messages
      upcomingInput: /* @__PURE__ */ __name(function() {
        var next = this.match;
        if (next.length < 20) {
          next += this._input.substr(0, 20 - next.length);
        }
        return (next.substr(0, 20) + (next.length > 20 ? "..." : "")).replace(/\n/g, "");
      }, "upcomingInput"),
      // displays the character position where the lexing error occurred, i.e. for error messages
      showPosition: /* @__PURE__ */ __name(function() {
        var pre = this.pastInput();
        var c = new Array(pre.length + 1).join("-");
        return pre + this.upcomingInput() + "\n" + c + "^";
      }, "showPosition"),
      // test the lexed token: return FALSE when not a match, otherwise return token
      test_match: /* @__PURE__ */ __name(function(match, indexed_rule) {
        var token, lines, backup;
        if (this.options.backtrack_lexer) {
          backup = {
            yylineno: this.yylineno,
            yylloc: {
              first_line: this.yylloc.first_line,
              last_line: this.last_line,
              first_column: this.yylloc.first_column,
              last_column: this.yylloc.last_column
            },
            yytext: this.yytext,
            match: this.match,
            matches: this.matches,
            matched: this.matched,
            yyleng: this.yyleng,
            offset: this.offset,
            _more: this._more,
            _input: this._input,
            yy: this.yy,
            conditionStack: this.conditionStack.slice(0),
            done: this.done
          };
          if (this.options.ranges) {
            backup.yylloc.range = this.yylloc.range.slice(0);
          }
        }
        lines = match[0].match(/(?:\r\n?|\n).*/g);
        if (lines) {
          this.yylineno += lines.length;
        }
        this.yylloc = {
          first_line: this.yylloc.last_line,
          last_line: this.yylineno + 1,
          first_column: this.yylloc.last_column,
          last_column: lines ? lines[lines.length - 1].length - lines[lines.length - 1].match(/\r?\n?/)[0].length : this.yylloc.last_column + match[0].length
        };
        this.yytext += match[0];
        this.match += match[0];
        this.matches = match;
        this.yyleng = this.yytext.length;
        if (this.options.ranges) {
          this.yylloc.range = [this.offset, this.offset += this.yyleng];
        }
        this._more = false;
        this._backtrack = false;
        this._input = this._input.slice(match[0].length);
        this.matched += match[0];
        token = this.performAction.call(this, this.yy, this, indexed_rule, this.conditionStack[this.conditionStack.length - 1]);
        if (this.done && this._input) {
          this.done = false;
        }
        if (token) {
          return token;
        } else if (this._backtrack) {
          for (var k in backup) {
            this[k] = backup[k];
          }
          return false;
        }
        return false;
      }, "test_match"),
      // return next match in input
      next: /* @__PURE__ */ __name(function() {
        if (this.done) {
          return this.EOF;
        }
        if (!this._input) {
          this.done = true;
        }
        var token, match, tempMatch, index;
        if (!this._more) {
          this.yytext = "";
          this.match = "";
        }
        var rules = this._currentRules();
        for (var i = 0; i < rules.length; i++) {
          tempMatch = this._input.match(this.rules[rules[i]]);
          if (tempMatch && (!match || tempMatch[0].length > match[0].length)) {
            match = tempMatch;
            index = i;
            if (this.options.backtrack_lexer) {
              token = this.test_match(tempMatch, rules[i]);
              if (token !== false) {
                return token;
              } else if (this._backtrack) {
                match = false;
                continue;
              } else {
                return false;
              }
            } else if (!this.options.flex) {
              break;
            }
          }
        }
        if (match) {
          token = this.test_match(match, rules[index]);
          if (token !== false) {
            return token;
          }
          return false;
        }
        if (this._input === "") {
          return this.EOF;
        } else {
          return this.parseError("Lexical error on line " + (this.yylineno + 1) + ". Unrecognized text.\n" + this.showPosition(), {
            text: "",
            token: null,
            line: this.yylineno
          });
        }
      }, "next"),
      // return next match that has a token
      lex: /* @__PURE__ */ __name(function lex() {
        var r = this.next();
        if (r) {
          return r;
        } else {
          return this.lex();
        }
      }, "lex"),
      // activates a new lexer condition state (pushes the new lexer condition state onto the condition stack)
      begin: /* @__PURE__ */ __name(function begin(condition) {
        this.conditionStack.push(condition);
      }, "begin"),
      // pop the previously active lexer condition state off the condition stack
      popState: /* @__PURE__ */ __name(function popState() {
        var n = this.conditionStack.length - 1;
        if (n > 0) {
          return this.conditionStack.pop();
        } else {
          return this.conditionStack[0];
        }
      }, "popState"),
      // produce the lexer rule set which is active for the currently active lexer condition state
      _currentRules: /* @__PURE__ */ __name(function _currentRules() {
        if (this.conditionStack.length && this.conditionStack[this.conditionStack.length - 1]) {
          return this.conditions[this.conditionStack[this.conditionStack.length - 1]].rules;
        } else {
          return this.conditions["INITIAL"].rules;
        }
      }, "_currentRules"),
      // return the currently active lexer condition state; when an index argument is provided it produces the N-th previous condition state, if available
      topState: /* @__PURE__ */ __name(function topState(n) {
        n = this.conditionStack.length - 1 - Math.abs(n || 0);
        if (n >= 0) {
          return this.conditionStack[n];
        } else {
          return "INITIAL";
        }
      }, "topState"),
      // alias for begin(condition)
      pushState: /* @__PURE__ */ __name(function pushState(condition) {
        this.begin(condition);
      }, "pushState"),
      // return the number of states currently on the stack
      stateStackSize: /* @__PURE__ */ __name(function stateStackSize() {
        return this.conditionStack.length;
      }, "stateStackSize"),
      options: { "case-insensitive": true },
      performAction: /* @__PURE__ */ __name(function anonymous(yy, yy_, $avoiding_name_collisions, YY_START) {
        var YYSTATE = YY_START;
        switch ($avoiding_name_collisions) {
          case 0:
            return 5;
            break;
          case 1:
            break;
          case 2:
            break;
          case 3:
            break;
          case 4:
            break;
          case 5:
            break;
          case 6:
            return 20;
            break;
          case 7:
            this.begin("CONFIG");
            return 75;
            break;
          case 8:
            return 76;
            break;
          case 9:
            this.popState();
            this.begin("ALIAS");
            return 77;
            break;
          case 10:
            this.popState();
            this.popState();
            return 77;
            break;
          case 11:
            yy_.yytext = yy_.yytext.trim();
            return 73;
            break;
          case 12:
            yy_.yytext = yy_.yytext.trim();
            this.begin("ALIAS");
            return 73;
            break;
          case 13:
            yy_.yytext = yy_.yytext.trim();
            this.popState();
            return 73;
            break;
          case 14:
            this.popState();
            return 10;
            break;
          case 15:
            yy_.yytext = yy_.yytext.trim();
            this.popState();
            return 10;
            break;
          case 16:
            this.begin("LINE");
            return 15;
            break;
          case 17:
            this.begin("ID");
            return 51;
            break;
          case 18:
            this.begin("ID");
            return 53;
            break;
          case 19:
            return 14;
            break;
          case 20:
            this.begin("ID");
            return 54;
            break;
          case 21:
            this.popState();
            this.popState();
            this.begin("LINE");
            return 52;
            break;
          case 22:
            this.popState();
            this.popState();
            return 5;
            break;
          case 23:
            this.begin("LINE");
            return 37;
            break;
          case 24:
            this.begin("LINE");
            return 38;
            break;
          case 25:
            this.begin("LINE");
            return 39;
            break;
          case 26:
            this.begin("LINE");
            return 40;
            break;
          case 27:
            this.begin("LINE");
            return 50;
            break;
          case 28:
            this.begin("LINE");
            return 42;
            break;
          case 29:
            this.begin("LINE");
            return 44;
            break;
          case 30:
            this.begin("LINE");
            return 49;
            break;
          case 31:
            this.begin("LINE");
            return 45;
            break;
          case 32:
            this.begin("LINE");
            return 48;
            break;
          case 33:
            this.begin("LINE");
            return 47;
            break;
          case 34:
            this.popState();
            return 16;
            break;
          case 35:
            return 17;
            break;
          case 36:
            return 67;
            break;
          case 37:
            return 68;
            break;
          case 38:
            return 61;
            break;
          case 39:
            return 62;
            break;
          case 40:
            return 63;
            break;
          case 41:
            return 64;
            break;
          case 42:
            return 59;
            break;
          case 43:
            return 56;
            break;
          case 44:
            this.begin("ID");
            return 22;
            break;
          case 45:
            this.begin("ID");
            return 24;
            break;
          case 46:
            return 30;
            break;
          case 47:
            return 31;
            break;
          case 48:
            this.begin("acc_title");
            return 32;
            break;
          case 49:
            this.popState();
            return "acc_title_value";
            break;
          case 50:
            this.begin("acc_descr");
            return 34;
            break;
          case 51:
            this.popState();
            return "acc_descr_value";
            break;
          case 52:
            this.begin("acc_descr_multiline");
            break;
          case 53:
            this.popState();
            break;
          case 54:
            return "acc_descr_multiline_value";
            break;
          case 55:
            return 6;
            break;
          case 56:
            return 19;
            break;
          case 57:
            return 21;
            break;
          case 58:
            return 66;
            break;
          case 59:
            return 5;
            break;
          case 60:
            yy_.yytext = yy_.yytext.trim();
            return 73;
            break;
          case 61:
            return 80;
            break;
          case 62:
            return 97;
            break;
          case 63:
            return 98;
            break;
          case 64:
            return 99;
            break;
          case 65:
            return 78;
            break;
          case 66:
            return 79;
            break;
          case 67:
            return 100;
            break;
          case 68:
            return 101;
            break;
          case 69:
            return 102;
            break;
          case 70:
            return 103;
            break;
          case 71:
            return 85;
            break;
          case 72:
            return 86;
            break;
          case 73:
            return 87;
            break;
          case 74:
            return 88;
            break;
          case 75:
            return 93;
            break;
          case 76:
            return 94;
            break;
          case 77:
            return 95;
            break;
          case 78:
            return 96;
            break;
          case 79:
            return 81;
            break;
          case 80:
            return 82;
            break;
          case 81:
            return 83;
            break;
          case 82:
            return 84;
            break;
          case 83:
            return 89;
            break;
          case 84:
            return 90;
            break;
          case 85:
            return 91;
            break;
          case 86:
            return 92;
            break;
          case 87:
            return 104;
            break;
          case 88:
            return 104;
            break;
          case 89:
            return 70;
            break;
          case 90:
            return 71;
            break;
          case 91:
            return 72;
            break;
          case 92:
            return 5;
            break;
          case 93:
            return 10;
            break;
        }
      }, "anonymous"),
      rules: [/^(?:[\n]+)/i, /^(?:\s+)/i, /^(?:((?!\n)\s)+)/i, /^(?:#[^\n]*)/i, /^(?:%(?!\{)[^\n]*)/i, /^(?:[^\}]%%[^\n]*)/i, /^(?:([0-9]+(\.[0-9]{1,2})?|\.[0-9]{1,2})(?=[ \n]+))/i, /^(?:@\{)/i, /^(?:[^\}]+)/i, /^(?:\}(?=\s+as\s))/i, /^(?:\})/i, /^(?:[^<>:\n,;@\s]+(?=\s*@\{))/i, /^(?:[^<>:\n,;@\s]+(?=\s+as\s))/i, /^(?:[^<>:\n,;@]+(?=\s*[\n;#]|$))/i, /^(?:[^<>:\n,;@]*<[^\n]*)/i, /^(?:[^\n]+)/i, /^(?:box\b)/i, /^(?:participant\b)/i, /^(?:actor\b)/i, /^(?:create\b)/i, /^(?:destroy\b)/i, /^(?:as\b)/i, /^(?:(?:))/i, /^(?:loop\b)/i, /^(?:rect\b)/i, /^(?:opt\b)/i, /^(?:alt\b)/i, /^(?:else\b)/i, /^(?:par\b)/i, /^(?:par_over\b)/i, /^(?:and\b)/i, /^(?:critical\b)/i, /^(?:option\b)/i, /^(?:break\b)/i, /^(?:(?:[:]?(?:no)?wrap)?[^#\n;]*)/i, /^(?:end\b)/i, /^(?:left of\b)/i, /^(?:right of\b)/i, /^(?:links(?=[ \t]+[^\/\\\+\(\)<>:\n,;\s\-]))/i, /^(?:link(?=[ \t]+[^\/\\\+\(\)<>:\n,;\s\-]))/i, /^(?:properties(?=[ \t]+[^\/\\\+\(\)<>:\n,;\s\-]))/i, /^(?:details(?=[ \t]+[^\/\\\+\(\)<>:\n,;\s\-]))/i, /^(?:over\b)/i, /^(?:note\b)/i, /^(?:activate\b)/i, /^(?:deactivate\b)/i, /^(?:title\s[^#\n;]+)/i, /^(?:title:\s[^#\n;]+)/i, /^(?:accTitle\s*:\s*)/i, /^(?:(?!\n||)*[^\n]*)/i, /^(?:accDescr\s*:\s*)/i, /^(?:(?!\n||)*[^\n]*)/i, /^(?:accDescr\s*\{\s*)/i, /^(?:[\}])/i, /^(?:[^\}]*)/i, /^(?:sequenceDiagram\b)/i, /^(?:autonumber\b)/i, /^(?:off\b)/i, /^(?:,)/i, /^(?:;)/i, /^(?:[^\/\\\+\()\+<\->\->:\n,;]+((?!(-x|--x|-\)|--\)|-\|\\|-\\|-\/|-\/\/|-\|\/|\/\|-|\\\|-|\/\/-|\\\\-|\/\|-|--\|\\|--|\(\)))[\-]*[^\+<\->\->:\n,;]+)*)/i, /^(?:->>)/i, /^(?:<<->>)/i, /^(?:-->>)/i, /^(?:<<-->>)/i, /^(?:->)/i, /^(?:-->)/i, /^(?:-[x])/i, /^(?:--[x])/i, /^(?:-[\)])/i, /^(?:--[\)])/i, /^(?:--\|\\)/i, /^(?:--\|\/)/i, /^(?:--\\\\)/i, /^(?:--\/\/)/i, /^(?:\/\|--)/i, /^(?:\\\|--)/i, /^(?:\/\/--)/i, /^(?:\\\\--)/i, /^(?:-\|\\)/i, /^(?:-\|\/)/i, /^(?:-\\\\)/i, /^(?:-\/\/)/i, /^(?:\/\|-)/i, /^(?:\\\|-)/i, /^(?:\/\/-)/i, /^(?:\\\\-)/i, /^(?::(?:(?:no)?wrap)?[^#\n;]*)/i, /^(?::)/i, /^(?:\+)/i, /^(?:-)/i, /^(?:\(\))/i, /^(?:$)/i, /^(?:.)/i],
      conditions: { "acc_descr_multiline": { "rules": [53, 54], "inclusive": false }, "acc_descr": { "rules": [51], "inclusive": false }, "acc_title": { "rules": [49], "inclusive": false }, "ID": { "rules": [2, 3, 7, 11, 12, 13, 14, 15], "inclusive": false }, "ALIAS": { "rules": [2, 3, 21, 22], "inclusive": false }, "LINE": { "rules": [2, 3, 34], "inclusive": false }, "CONFIG": { "rules": [8, 9, 10], "inclusive": false }, "CONFIG_DATA": { "rules": [], "inclusive": false }, "INITIAL": { "rules": [0, 1, 3, 4, 5, 6, 16, 17, 18, 19, 20, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 50, 52, 55, 56, 57, 58, 59, 60, 61, 62, 63, 64, 65, 66, 67, 68, 69, 70, 71, 72, 73, 74, 75, 76, 77, 78, 79, 80, 81, 82, 83, 84, 85, 86, 87, 88, 89, 90, 91, 92, 93], "inclusive": true } }
    };
    return lexer2;
  })();
  parser2.lexer = lexer;
  function Parser() {
    this.yy = {};
  }
  __name(Parser, "Parser");
  Parser.prototype = parser2;
  parser2.Parser = Parser;
  return new Parser();
})();
parser.parser = parser;
var sequenceDiagram_default = parser;


export default parser;
