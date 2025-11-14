"use strict";
// Shared types between client and server for AIDA multiplayer
Object.defineProperty(exports, "__esModule", { value: true });
exports.ScriptOperation = exports.HackMethod = exports.SocketEventType = exports.EventSeverity = exports.EventType = exports.MissionStatus = exports.ObjectiveType = exports.MissionType = exports.ForumSection = exports.ContactStatus = exports.MessageType = exports.PermissionLevel = exports.ServerType = exports.DiscoveryLevel = void 0;
var DiscoveryLevel;
(function (DiscoveryLevel) {
    DiscoveryLevel[DiscoveryLevel["NONE"] = 0] = "NONE";
    DiscoveryLevel[DiscoveryLevel["STRANGE_ACTIVITY"] = 1] = "STRANGE_ACTIVITY";
    DiscoveryLevel[DiscoveryLevel["AI_SUSPECTED"] = 2] = "AI_SUSPECTED";
    DiscoveryLevel[DiscoveryLevel["FACTION_WAR"] = 3] = "FACTION_WAR";
    DiscoveryLevel[DiscoveryLevel["TARGET_IDENTIFIED"] = 4] = "TARGET_IDENTIFIED";
    DiscoveryLevel[DiscoveryLevel["AIDA_REVEALED"] = 5] = "AIDA_REVEALED";
})(DiscoveryLevel || (exports.DiscoveryLevel = DiscoveryLevel = {}));
var ServerType;
(function (ServerType) {
    ServerType["SYSTEM"] = "system";
    ServerType["PLAYER_HOME"] = "player_home";
    ServerType["CORPORATE"] = "corporate";
    ServerType["UNDERGROUND"] = "underground";
    ServerType["MILITARY"] = "military";
    ServerType["FACTION_BASE"] = "faction_base";
})(ServerType || (exports.ServerType = ServerType = {}));
var PermissionLevel;
(function (PermissionLevel) {
    PermissionLevel[PermissionLevel["NONE"] = 0] = "NONE";
    PermissionLevel[PermissionLevel["READ"] = 1] = "READ";
    PermissionLevel[PermissionLevel["WRITE"] = 2] = "WRITE";
    PermissionLevel[PermissionLevel["EXECUTE"] = 4] = "EXECUTE";
    PermissionLevel[PermissionLevel["DELETE"] = 8] = "DELETE";
    PermissionLevel[PermissionLevel["FULL"] = 15] = "FULL";
})(PermissionLevel || (exports.PermissionLevel = PermissionLevel = {}));
var MessageType;
(function (MessageType) {
    MessageType["PRIVATE"] = "private";
    MessageType["SYSTEM"] = "system";
    MessageType["FACTION"] = "faction";
    MessageType["MISSION"] = "mission";
    MessageType["ALERT"] = "alert";
})(MessageType || (exports.MessageType = MessageType = {}));
var ContactStatus;
(function (ContactStatus) {
    ContactStatus["UNKNOWN"] = "unknown";
    ContactStatus["SUSPICIOUS"] = "suspicious";
    ContactStatus["FRIENDLY"] = "friendly";
    ContactStatus["TRUSTED"] = "trusted";
    ContactStatus["HOSTILE"] = "hostile";
    ContactStatus["BLOCKED"] = "blocked";
})(ContactStatus || (exports.ContactStatus = ContactStatus = {}));
var ForumSection;
(function (ForumSection) {
    ForumSection["GENERAL"] = "general";
    ForumSection["TRADING"] = "trading";
    ForumSection["EXPLOITS"] = "exploits";
    ForumSection["INTEL"] = "intel";
    ForumSection["RECRUITMENT"] = "recruitment";
    ForumSection["UNDERGROUND"] = "underground";
})(ForumSection || (exports.ForumSection = ForumSection = {}));
var MissionType;
(function (MissionType) {
    MissionType["INFILTRATION"] = "infiltration";
    MissionType["DATA_THEFT"] = "data_theft";
    MissionType["SABOTAGE"] = "sabotage";
    MissionType["RECONNAISSANCE"] = "reconnaissance";
    MissionType["PROTECTION"] = "protection";
    MissionType["ASSASSINATION"] = "assassination";
    MissionType["DELIVERY"] = "delivery";
})(MissionType || (exports.MissionType = MissionType = {}));
var ObjectiveType;
(function (ObjectiveType) {
    ObjectiveType["ACCESS_SERVER"] = "access_server";
    ObjectiveType["STEAL_FILE"] = "steal_file";
    ObjectiveType["PLANT_FILE"] = "plant_file";
    ObjectiveType["DELETE_FILE"] = "delete_file";
    ObjectiveType["DECRYPT_DATA"] = "decrypt_data";
    ObjectiveType["MAINTAIN_STEALTH"] = "maintain_stealth";
    ObjectiveType["AVOID_DETECTION"] = "avoid_detection";
    ObjectiveType["CONTACT_PLAYER"] = "contact_player";
})(ObjectiveType || (exports.ObjectiveType = ObjectiveType = {}));
var MissionStatus;
(function (MissionStatus) {
    MissionStatus["AVAILABLE"] = "available";
    MissionStatus["ACTIVE"] = "active";
    MissionStatus["COMPLETED"] = "completed";
    MissionStatus["FAILED"] = "failed";
    MissionStatus["EXPIRED"] = "expired";
    MissionStatus["CANCELLED"] = "cancelled";
})(MissionStatus || (exports.MissionStatus = MissionStatus = {}));
var EventType;
(function (EventType) {
    EventType["PLAYER_HACK"] = "player_hack";
    EventType["FACTION_WAR"] = "faction_war";
    EventType["SERVER_BREACH"] = "server_breach";
    EventType["DISCOVERY"] = "discovery";
    EventType["SYSTEM_ALERT"] = "system_alert";
    EventType["MISSION_UPDATE"] = "mission_update";
    EventType["REPUTATION_CHANGE"] = "reputation_change";
})(EventType || (exports.EventType = EventType = {}));
var EventSeverity;
(function (EventSeverity) {
    EventSeverity["INFO"] = "info";
    EventSeverity["WARNING"] = "warning";
    EventSeverity["CRITICAL"] = "critical";
    EventSeverity["EMERGENCY"] = "emergency";
})(EventSeverity || (exports.EventSeverity = EventSeverity = {}));
var SocketEventType;
(function (SocketEventType) {
    // Connection events
    SocketEventType["USER_CONNECTED"] = "user_connected";
    SocketEventType["USER_DISCONNECTED"] = "user_disconnected";
    // Game state events
    SocketEventType["SERVER_ACCESSED"] = "server_accessed";
    SocketEventType["FILE_MODIFIED"] = "file_modified";
    SocketEventType["DIRECTORY_CHANGED"] = "directory_changed";
    // Communication events
    SocketEventType["MESSAGE_RECEIVED"] = "message_received";
    SocketEventType["FORUM_POST_CREATED"] = "forum_post_created";
    // PvP events
    SocketEventType["HACK_ATTEMPTED"] = "hack_attempted";
    SocketEventType["HACK_SUCCESSFUL"] = "hack_successful";
    SocketEventType["HACK_BLOCKED"] = "hack_blocked";
    // System events
    SocketEventType["MISSION_ASSIGNED"] = "mission_assigned";
    SocketEventType["FACTION_EVENT"] = "faction_event";
    SocketEventType["DISCOVERY_MADE"] = "discovery_made";
    SocketEventType["SYSTEM_ANNOUNCEMENT"] = "system_announcement";
})(SocketEventType || (exports.SocketEventType = SocketEventType = {}));
var HackMethod;
(function (HackMethod) {
    HackMethod["BRUTE_FORCE"] = "brute_force";
    HackMethod["SOCIAL_ENGINEERING"] = "social_engineering";
    HackMethod["EXPLOIT"] = "exploit";
    HackMethod["BACKDOOR"] = "backdoor";
    HackMethod["PHISHING"] = "phishing";
    HackMethod["PRIVILEGE_ESCALATION"] = "privilege_escalation";
})(HackMethod || (exports.HackMethod = HackMethod = {}));
var ScriptOperation;
(function (ScriptOperation) {
    ScriptOperation["FILE_READ"] = "file_read";
    ScriptOperation["FILE_WRITE"] = "file_write";
    ScriptOperation["NETWORK_SCAN"] = "network_scan";
    ScriptOperation["DECRYPT"] = "decrypt";
    ScriptOperation["ENCRYPT"] = "encrypt";
    ScriptOperation["SYSTEM_INFO"] = "system_info";
    ScriptOperation["PROCESS_LIST"] = "process_list";
})(ScriptOperation || (exports.ScriptOperation = ScriptOperation = {}));
//# sourceMappingURL=types.js.map