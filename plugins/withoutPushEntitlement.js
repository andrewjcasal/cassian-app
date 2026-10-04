// expo-widgets writes the aps-environment (push) entitlement even when its
// enablePushNotifications option is off. A free personal Apple team can't sign
// an app that has it, and Cassian doesn't use push, so this removes it. Mods
// on the same file run in reverse order, so it's listed BEFORE expo-widgets in
// app.json to run after it.
const { withEntitlementsPlist } = require('expo/config-plugins')

module.exports = function withoutPushEntitlement(config) {
  return withEntitlementsPlist(config, (mod) => {
    delete mod.modResults['aps-environment']
    return mod
  })
}
