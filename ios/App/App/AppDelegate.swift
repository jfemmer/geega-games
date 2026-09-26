import UIKit
import Capacitor

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        installNotificationSounds()
        return true
    }

    // MARK: - Push notifications (see api/_lib/apns.ts and docs/IOS_APP.md)

    // Hand the APNs device token (or the failure) to the @capacitor/push-notifications
    // plugin, which passes it to the dashboard to register this iPhone.
    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        NotificationCenter.default.post(name: .capacitorDidRegisterForRemoteNotifications, object: deviceToken)
    }

    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        NotificationCenter.default.post(name: .capacitorDidFailToRegisterForRemoteNotifications, object: error)
    }

    /// Each kind of alert (new order, buying lead, partner lead, sign-up) has its
    /// own sound. The .wav files ship in the bundled web folder
    /// (native/www/sounds → public/sounds), but iOS only plays custom push sounds
    /// from the app bundle root or Library/Sounds — so copy them there on launch.
    /// The server names the file in each push's "sound" field.
    private func installNotificationSounds() {
        let fileManager = FileManager.default
        guard let source = Bundle.main.resourceURL?.appendingPathComponent("public/sounds", isDirectory: true),
              let library = fileManager.urls(for: .libraryDirectory, in: .userDomainMask).first else { return }
        let target = library.appendingPathComponent("Sounds", isDirectory: true)
        do {
            try fileManager.createDirectory(at: target, withIntermediateDirectories: true)
            let files = try fileManager.contentsOfDirectory(at: source, includingPropertiesForKeys: nil)
            for file in files where file.pathExtension == "wav" {
                let destination = target.appendingPathComponent(file.lastPathComponent)
                if fileManager.fileExists(atPath: destination.path) {
                    try fileManager.removeItem(at: destination)
                }
                try fileManager.copyItem(at: file, to: destination)
            }
        } catch {
            NSLog("Geega Admin: couldn't install notification sounds: \(error)")
        }
    }

    func applicationWillResignActive(_ application: UIApplication) {
        // Sent when the application is about to move from active to inactive state. This can occur for certain types of temporary interruptions (such as an incoming phone call or SMS message) or when the user quits the application and it begins the transition to the background state.
        // Use this method to pause ongoing tasks, disable timers, and invalidate graphics rendering callbacks. Games should use this method to pause the game.
    }

    func applicationDidEnterBackground(_ application: UIApplication) {
        // Use this method to release shared resources, save user data, invalidate timers, and store enough application state information to restore your application to its current state in case it is terminated later.
        // If your application supports background execution, this method is called instead of applicationWillTerminate: when the user quits.
    }

    func applicationWillEnterForeground(_ application: UIApplication) {
        // Called as part of the transition from the background to the active state; here you can undo many of the changes made on entering the background.
    }

    func applicationDidBecomeActive(_ application: UIApplication) {
        // Restart any tasks that were paused (or not yet started) while the application was inactive. If the application was previously in the background, optionally refresh the user interface.
    }

    func applicationWillTerminate(_ application: UIApplication) {
        // Called when the application is about to terminate. Save data if appropriate. See also applicationDidEnterBackground:.
    }

    func application(_ application: UIApplication,
                     configurationForConnecting connectingSceneSession: UISceneSession,
                     options: UIScene.ConnectionOptions) -> UISceneConfiguration {
        let config = UISceneConfiguration(name: "Default Configuration",
                                          sessionRole: connectingSceneSession.role)
        config.delegateClass = SceneDelegate.self
        return config
    }
}
