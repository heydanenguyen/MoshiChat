// Moshi setup / uninstall front end (WPF on .NET Framework 4.8, present on every Windows 10/11).
// The real work is done by the electron-builder NSIS package, run silently underneath:
//   setup:     payload.exe /S          (per-user, no admin), progress = install folder size vs expected size
//   uninstall: <nsis uninstaller> /S   (the Windows "Uninstall" entry points to this program instead)
//   update:    the NSIS package runs the registered uninstaller with /S; this program then removes the old
//              version headlessly (SilentUninstall) instead of showing the goodbye window
// The window (Window.xaml) and the character art (assets/*.png, drawn from src/shared/logos.ts) are
// embedded resources. Built by scripts/build-setup.mjs.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Markup;
using System.Windows.Media;
using System.Windows.Media.Animation;
using System.Windows.Media.Imaging;
using System.Windows.Shapes;
using System.Windows.Threading;
using Microsoft.Win32;

[assembly: AssemblyTitle("Moshi Setup")]
[assembly: AssemblyProduct("Moshi")]
[assembly: AssemblyCompany("3HVN Media")]
[assembly: System.Runtime.Versioning.TargetFramework(".NETFramework,Version=v4.8")]

namespace MoshiSetup
{
    static class Program
    {
        [STAThread]
        static int Main(string[] args)
        {
            // --lang=vi / --lang=en overrides the Windows language (handy for checking both).
            if (args.Contains("--lang=vi")) L.Vietnamese = true;
            if (args.Contains("--lang=en")) L.Vietnamese = false;
            bool uninstall = args.Contains("--uninstall") || !Res.Has("payload.exe");
            // The NSIS package, while updating, copies whatever "Uninstall" points at (this program) to %TEMP%
            // and runs it with /S. Remove the old version quietly with the real NSIS uninstaller and report its
            // result; never open the goodbye window in the middle of an update.
            if (uninstall && args.Any(a => a.Equals("/S", StringComparison.OrdinalIgnoreCase))) return SilentUninstall(args);
            if (uninstall && !args.Contains("--relaunched"))
            {
                // The uninstaller lives in the folder it removes: run a copy from %TEMP% instead.
                string self = Assembly.GetExecutingAssembly().Location;
                string copy = System.IO.Path.Combine(System.IO.Path.GetTempPath(), "moshi-goodbye-" + Guid.NewGuid().ToString("N").Substring(0, 8) + ".exe");
                File.Copy(self, copy, true);
                Process.Start(new ProcessStartInfo(copy, "--uninstall --relaunched" + (args.Contains("--lang=vi") ? " --lang=vi" : args.Contains("--lang=en") ? " --lang=en" : "")) { UseShellExecute = false });
                return 0;
            }
            var app = new Application { ShutdownMode = ShutdownMode.OnMainWindowClose };
            var ui = new SetupWindow(uninstall);
            app.MainWindow = ui.Window;
            return app.Run(ui.Window);
        }

        /// <summary>
        /// Headless uninstall for the NSIS package (and anything else that passes /S): runs the NSIS uninstaller
        /// the package registered, forwarding its flags (/KEEP_APP_DATA, /currentuser, --updated, _?=dir).
        /// Nothing to remove counts as success, so an update over a half-removed install still goes ahead.
        /// </summary>
        static int SilentUninstall(string[] args)
        {
            try
            {
                var entry = InstallEntry.Find();
                string core = entry?.Get("MoshiCoreUninstall") ?? entry?.Get("QuietUninstallString");
                if (string.IsNullOrEmpty(core)) return 0;
                string exe = core.StartsWith("\"") ? core.Substring(1, core.IndexOf('"', 1) - 1) : core.Split(' ')[0];
                if (!File.Exists(exe)) return 0;
                // "_?=<dir>" is unquoted and must stay last (NSIS reads everything after it as the path), so take
                // it from the raw command line rather than from the split-up args.
                string cmd = Environment.CommandLine;
                int at = cmd.IndexOf("_?=", StringComparison.Ordinal);
                string dir = at >= 0 ? cmd.Substring(at + 3).Trim() : (entry?.Location ?? System.IO.Path.GetDirectoryName(exe));
                var flags = args.TakeWhile(a => !a.StartsWith("_?=", StringComparison.Ordinal))
                    .Where(a => (a.StartsWith("/") || a.StartsWith("--")) && !a.StartsWith("--uninstall") && !a.StartsWith("--relaunched") && !a.StartsWith("--lang="))
                    .Distinct(StringComparer.OrdinalIgnoreCase)
                    .ToList();
                if (!flags.Any(f => f.Equals("/S", StringComparison.OrdinalIgnoreCase))) flags.Insert(0, "/S");
                var p = Process.Start(new ProcessStartInfo(exe, string.Join(" ", flags) + " _?=" + dir) { UseShellExecute = false, CreateNoWindow = true });
                p.WaitForExit();
                return p.ExitCode;
            }
            catch
            {
                return 1;
            }
        }
    }

    /// <summary>English by default; Vietnamese when Windows itself is in Vietnamese.</summary>
    static class L
    {
        public static bool Vietnamese = System.Globalization.CultureInfo.CurrentUICulture.TwoLetterISOLanguageName == "vi";

        public static string T(string en, string vi) => Vietnamese ? vi : en;
    }

    /// <summary>Embedded resources.</summary>
    static class Res
    {
        public static Stream Stream(string name) => Assembly.GetExecutingAssembly().GetManifestResourceStream(name);

        public static bool Has(string name) => Assembly.GetExecutingAssembly().GetManifestResourceNames().Contains(name);

        public static string Text(string name)
        {
            using (var s = Stream(name))
            {
                if (s == null) return null;
                using (var r = new StreamReader(s)) return r.ReadToEnd();
            }
        }

        public static BitmapImage Image(string name)
        {
            var s = Stream(name);
            if (s == null) return null;
            var img = new BitmapImage();
            img.BeginInit();
            img.CacheOption = BitmapCacheOption.OnLoad;
            img.StreamSource = s;
            img.EndInit();
            img.Freeze();
            return img;
        }

        public static void Save(string name, string path)
        {
            using (var s = Stream(name))
            using (var f = File.Create(path)) s.CopyTo(f);
        }
    }

    /// <summary>The per-user "Apps & features" entry written by the NSIS package.</summary>
    class InstallEntry
    {
        const string UninstallRoot = @"Software\Microsoft\Windows\CurrentVersion\Uninstall";
        public string KeyPath;
        public string Location;
        public string Version;

        public static InstallEntry Find() => FindByName("Moshi");

        /// <summary>The entry left by versions that were still called Unison.</summary>
        public static InstallEntry FindLegacy() => FindByName("Unison");

        static InstallEntry FindByName(string displayName)
        {
            using (var root = Registry.CurrentUser.OpenSubKey(UninstallRoot))
            {
                if (root == null) return null;
                foreach (var name in root.GetSubKeyNames())
                {
                    using (var key = root.OpenSubKey(name))
                    {
                        if (key == null || (key.GetValue("DisplayName") as string) != displayName) continue;
                        return new InstallEntry
                        {
                            KeyPath = UninstallRoot + "\\" + name,
                            Location = NonEmpty((key.GetValue("InstallLocation") as string)?.Trim('"')),
                            Version = key.GetValue("DisplayVersion") as string
                        };
                    }
                }
            }
            return null;
        }

        static string NonEmpty(string s) => string.IsNullOrWhiteSpace(s) ? null : s;

        public string Get(string value)
        {
            using (var key = Registry.CurrentUser.OpenSubKey(KeyPath)) return key?.GetValue(value) as string;
        }

        public void Set(string value, string data)
        {
            using (var key = Registry.CurrentUser.OpenSubKey(KeyPath, true)) key?.SetValue(value, data);
        }
    }

    class SetupWindow
    {
        public readonly Window Window;
        readonly bool uninstallMode;
        readonly string version;
        readonly long expectedBytes;
        readonly string defaultDir = System.IO.Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Programs", "Moshi");

        // named elements
        readonly Grid duo, orangeHost, bubble;
        readonly Image pink, orange, blink;
        readonly StackPanel pair, content, welcomeActions, progressPanel, pairActions;
        readonly TextBlock bubbleText, heading, subtitle, finePrint, progressText, percent;
        readonly Border progressFill, step1, step2, step3;
        readonly Button installButton, primaryButton, secondaryButton, closeButton, minButton;
        readonly Canvas confetti;
        readonly Ellipse floor;

        Action onPrimary, onSecondary;
        bool busy;
        string installedDir;
        readonly Random rng = new Random();

        public SetupWindow(bool uninstall)
        {
            uninstallMode = uninstall;
            version = Res.Text("version.txt")?.Trim() ?? "";
            long.TryParse(Res.Text("expected.txt")?.Trim(), out expectedBytes);

            Window = (Window)XamlReader.Parse(Res.Text("Window.xaml"));
            T Find<T>(string name) where T : class => (T)Window.FindName(name);
            duo = Find<Grid>("Duo");
            orangeHost = Find<Grid>("OrangeHost");
            bubble = Find<Grid>("Bubble");
            pink = Find<Image>("Pink");
            orange = Find<Image>("Orange");
            blink = Find<Image>("Blink");
            pair = Find<StackPanel>("Pair");
            content = Find<StackPanel>("Content");
            welcomeActions = Find<StackPanel>("WelcomeActions");
            progressPanel = Find<StackPanel>("ProgressPanel");
            pairActions = Find<StackPanel>("PairActions");
            bubbleText = Find<TextBlock>("BubbleText");
            heading = Find<TextBlock>("Heading");
            subtitle = Find<TextBlock>("Subtitle");
            finePrint = Find<TextBlock>("FinePrint");
            progressText = Find<TextBlock>("ProgressText");
            percent = Find<TextBlock>("Percent");
            progressFill = Find<Border>("ProgressFill");
            step1 = Find<Border>("Step1");
            step2 = Find<Border>("Step2");
            step3 = Find<Border>("Step3");
            installButton = Find<Button>("InstallButton");
            primaryButton = Find<Button>("PrimaryButton");
            secondaryButton = Find<Button>("SecondaryButton");
            closeButton = Find<Button>("CloseButton");
            minButton = Find<Button>("MinButton");
            confetti = Find<Canvas>("Confetti");
            floor = Find<Ellipse>("Floor");

            Find<Image>("LogoSmall").Source = Res.Image("logo-small.png");
            pink.Source = Res.Image("duo-pink.png");
            orange.Source = Res.Image("duo-orange.png");
            blink.Source = Res.Image("duo-orange-blink.png");
            Find<Image>("CalmOrange").Source = Res.Image("calm-buddies.png");
            Find<Image>("CalmPink").Source = Res.Image("calm-blossom.png");
            Find<TextBlock>("Version").Text = version.Length > 0 ? L.T("Version ", "Phiên bản ") + version : "";
            Window.Title = uninstallMode ? L.T("Uninstall Moshi", "Gỡ cài đặt Moshi") : L.T("Moshi Setup", "Cài đặt Moshi");
            minButton.ToolTip = L.T("Minimize", "Thu nhỏ");
            closeButton.ToolTip = L.T("Close", "Đóng");
            installButton.Content = L.T("Install", "Cài đặt");
            var icon = Res.Image("icon.png");
            if (icon != null) Window.Icon = icon;

            // Rotate/hop around each character's feet.
            PrepareTransform(orangeHost, 0.385, 0.95);
            PrepareTransform(pink, 0.66, 0.56);
            PrepareTransform(bubble, 0.12, 1);

            Window.MouseLeftButtonDown += (s, e) =>
            {
                if (!(e.OriginalSource is DependencyObject d && FindParent<Button>(d) != null)) Window.DragMove();
            };
            minButton.Click += (s, e) => Window.WindowState = WindowState.Minimized;
            closeButton.Click += (s, e) => TryClose();
            installButton.Click += (s, e) => onPrimary?.Invoke();
            primaryButton.Click += (s, e) => onPrimary?.Invoke();
            secondaryButton.Click += (s, e) => onSecondary?.Invoke();
            Window.KeyDown += (s, e) =>
            {
                if (e.Key == Key.Escape) TryClose();
            };
            Window.Closing += (s, e) =>
            {
                if (busy) e.Cancel = true;
            };
            Window.Loaded += (s, e) => Enter();
        }

        static T FindParent<T>(DependencyObject d) where T : DependencyObject
        {
            while (d != null && !(d is T)) d = d is Visual || d is System.Windows.Media.Media3D.Visual3D ? VisualTreeHelper.GetParent(d) : LogicalTreeHelper.GetParent(d);
            return d as T;
        }

        void TryClose()
        {
            if (busy)
            {
                Say(L.T("Hang on a sec!", "Đợi mình xíu nhé!"));
                return;
            }
            Window.Close();
        }

        // ------------------------------------------------------------------ animation helpers

        static readonly IEasingFunction EaseOut = new CubicEase { EasingMode = EasingMode.EaseOut };
        static readonly IEasingFunction EaseInOut = new SineEase { EasingMode = EasingMode.EaseInOut };
        static readonly IEasingFunction Pop = new BackEase { EasingMode = EasingMode.EaseOut, Amplitude = 0.45 };

        static void PrepareTransform(UIElement el, double ox, double oy)
        {
            el.RenderTransformOrigin = new Point(ox, oy);
            var g = new TransformGroup();
            g.Children.Add(new ScaleTransform(1, 1));
            g.Children.Add(new RotateTransform(0));
            g.Children.Add(new TranslateTransform(0, 0));
            el.RenderTransform = g;
        }

        static ScaleTransform ScaleOf(UIElement el) => (ScaleTransform)((TransformGroup)el.RenderTransform).Children[0];
        static RotateTransform RotateOf(UIElement el) => (RotateTransform)((TransformGroup)el.RenderTransform).Children[1];
        static TranslateTransform MoveOf(UIElement el) => (TranslateTransform)((TransformGroup)el.RenderTransform).Children[2];

        static DoubleAnimation To(double to, double ms, IEasingFunction ease = null, double delay = 0, double? from = null) =>
            new DoubleAnimation { To = to, From = from, Duration = TimeSpan.FromMilliseconds(ms), EasingFunction = ease ?? EaseOut, BeginTime = TimeSpan.FromMilliseconds(delay) };

        static DoubleAnimationUsingKeyFrames Keys(double totalMs, bool forever, double delay, params (double ms, double value)[] frames)
        {
            var a = new DoubleAnimationUsingKeyFrames { Duration = TimeSpan.FromMilliseconds(totalMs), BeginTime = TimeSpan.FromMilliseconds(delay) };
            if (forever) a.RepeatBehavior = RepeatBehavior.Forever;
            foreach (var f in frames) a.KeyFrames.Add(new EasingDoubleKeyFrame(f.value, KeyTime.FromTimeSpan(TimeSpan.FromMilliseconds(f.ms)), EaseInOut));
            return a;
        }

        static void Stop(UIElement el)
        {
            var s = ScaleOf(el);
            s.BeginAnimation(ScaleTransform.ScaleXProperty, null);
            s.BeginAnimation(ScaleTransform.ScaleYProperty, null);
            RotateOf(el).BeginAnimation(RotateTransform.AngleProperty, null);
            MoveOf(el).BeginAnimation(TranslateTransform.YProperty, null);
            // back to rest (PopIn starts from a base scale of 0)
            s.ScaleX = s.ScaleY = 1;
            RotateOf(el).Angle = 0;
            MoveOf(el).Y = 0;
        }

        /// <summary>Card fades/grows in, then the characters pop up one after the other and the bubble appears.</summary>
        void Enter()
        {
            var root = (FrameworkElement)Window.FindName("Root");
            root.Opacity = 0;
            root.BeginAnimation(UIElement.OpacityProperty, To(1, 320));
            var rs = (ScaleTransform)Window.FindName("RootScale");
            rs.BeginAnimation(ScaleTransform.ScaleXProperty, To(1, 420, Pop, 0, 0.95));
            rs.BeginAnimation(ScaleTransform.ScaleYProperty, To(1, 420, Pop, 0, 0.95));
            DriftBlobs();

            if (uninstallMode)
            {
                duo.Visibility = Visibility.Collapsed;
                pair.Visibility = Visibility.Visible;
                PrepareTransform(pair, 0.5, 1);
                PopIn(pair, 150);
                Goodbye();
            }
            else
            {
                PopIn(orangeHost, 160);
                PopIn(pink, 300);
                Welcome();
            }
            bubble.Opacity = 0;
            BubblePop(700);
            var idleAt = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(760) };
            idleAt.Tick += (s, e) =>
            {
                idleAt.Stop();
                if (!busy) Idle();
            };
            idleAt.Start();
        }

        void PopIn(UIElement el, double delay)
        {
            var s = ScaleOf(el);
            s.ScaleX = s.ScaleY = 0;
            s.BeginAnimation(ScaleTransform.ScaleXProperty, To(1, 560, Pop, delay, 0));
            s.BeginAnimation(ScaleTransform.ScaleYProperty, To(1, 560, Pop, delay, 0));
        }

        void BubblePop(double delay)
        {
            var s = ScaleOf(bubble);
            bubble.BeginAnimation(UIElement.OpacityProperty, To(1, 200, EaseOut, delay, 0));
            s.BeginAnimation(ScaleTransform.ScaleXProperty, To(1, 420, Pop, delay, 0.6));
            s.BeginAnimation(ScaleTransform.ScaleYProperty, To(1, 420, Pop, delay, 0.6));
        }

        void Say(string text)
        {
            bubbleText.Text = text;
            BubblePop(0);
        }

        void DriftBlobs()
        {
            int i = 0;
            foreach (var name in new[] { "BlobA", "BlobB", "BlobC" })
            {
                var t = (TranslateTransform)((UIElement)Window.FindName(name)).RenderTransform;
                t.BeginAnimation(TranslateTransform.XProperty, new DoubleAnimation(0, i % 2 == 0 ? 18 : -16, TimeSpan.FromSeconds(7 + i)) { AutoReverse = true, RepeatBehavior = RepeatBehavior.Forever, EasingFunction = EaseInOut });
                t.BeginAnimation(TranslateTransform.YProperty, new DoubleAnimation(0, i == 1 ? 14 : -12, TimeSpan.FromSeconds(9 - i)) { AutoReverse = true, RepeatBehavior = RepeatBehavior.Forever, EasingFunction = EaseInOut });
                i++;
            }
        }

        /// <summary>At rest: gentle bobbing out of step, the orange buddy waves and blinks now and then.</summary>
        void Idle()
        {
            var main = uninstallMode ? (UIElement)pair : orangeHost;
            Stop(main);
            MoveOf(main).BeginAnimation(TranslateTransform.YProperty, new DoubleAnimation(0, -4, TimeSpan.FromMilliseconds(1900)) { AutoReverse = true, RepeatBehavior = RepeatBehavior.Forever, EasingFunction = EaseInOut });
            if (uninstallMode) return;
            Stop(pink);
            MoveOf(pink).BeginAnimation(TranslateTransform.YProperty, new DoubleAnimation(0, -5, TimeSpan.FromMilliseconds(2200)) { AutoReverse = true, RepeatBehavior = RepeatBehavior.Forever, EasingFunction = EaseInOut, BeginTime = TimeSpan.FromMilliseconds(500) });
            RotateOf(orangeHost).BeginAnimation(RotateTransform.AngleProperty, Keys(5200, true, 0, (0, 0), (160, -8), (380, 7), (600, -5), (820, 3), (1040, 0), (5200, 0)));
            var b = new DoubleAnimationUsingKeyFrames { Duration = TimeSpan.FromMilliseconds(4600), RepeatBehavior = RepeatBehavior.Forever, BeginTime = TimeSpan.FromMilliseconds(1400) };
            b.KeyFrames.Add(new DiscreteDoubleKeyFrame(0, KeyTime.FromTimeSpan(TimeSpan.Zero)));
            b.KeyFrames.Add(new DiscreteDoubleKeyFrame(1, KeyTime.FromTimeSpan(TimeSpan.FromMilliseconds(3000))));
            b.KeyFrames.Add(new DiscreteDoubleKeyFrame(0, KeyTime.FromTimeSpan(TimeSpan.FromMilliseconds(3130))));
            blink.BeginAnimation(UIElement.OpacityProperty, b);
        }

        /// <summary>Working: the characters hop in turn (squash on landing, stretch on take-off).</summary>
        void Hop(UIElement el, double delay, int times = -1)
        {
            Stop(el);
            var total = 900.0;
            var y = Keys(total, times < 0, delay, (0, 0), (120, 0), (450, -18), (780, 0), (900, 0));
            var sx = Keys(total, times < 0, delay, (0, 1.08), (120, 0.94), (450, 1), (780, 1.06), (900, 1.08));
            var sy = Keys(total, times < 0, delay, (0, 0.9), (120, 1.07), (450, 1), (780, 0.95), (900, 0.9));
            if (times > 0)
            {
                y.RepeatBehavior = sx.RepeatBehavior = sy.RepeatBehavior = new RepeatBehavior(times);
                y.FillBehavior = sx.FillBehavior = sy.FillBehavior = FillBehavior.Stop;
            }
            MoveOf(el).BeginAnimation(TranslateTransform.YProperty, y);
            ScaleOf(el).BeginAnimation(ScaleTransform.ScaleXProperty, sx);
            ScaleOf(el).BeginAnimation(ScaleTransform.ScaleYProperty, sy);
        }

        void Working()
        {
            blink.BeginAnimation(UIElement.OpacityProperty, null);
            blink.Opacity = 0;
            if (uninstallMode) Hop(pair, 0);
            else
            {
                Hop(orangeHost, 0);
                Hop(pink, 450);
            }
        }

        void Steps(int active)
        {
            var steps = new[] { step1, step2, step3 };
            for (int i = 0; i < 3; i++)
            {
                bool on = i == active;
                steps[i].BeginAnimation(FrameworkElement.WidthProperty, To(on ? 22 : 6, 280));
                steps[i].Background = new SolidColorBrush(i <= active ? (Color)ColorConverter.ConvertFromString("#FF6A2B") : (Color)ColorConverter.ConvertFromString("#D9D2F2"));
            }
        }

        /// <summary>Swap the words and buttons with a short fade-and-rise.</summary>
        void Show(string bubbleSay, string title, string sub, string panel, string primary = null, string secondary = null, Action onP = null, Action onS = null)
        {
            var move = (TranslateTransform)content.RenderTransform;
            var fadeOut = To(0, 120);
            fadeOut.Completed += (s, e) =>
            {
                heading.Text = title;
                subtitle.Text = sub;
                welcomeActions.Visibility = panel == "welcome" ? Visibility.Visible : Visibility.Collapsed;
                progressPanel.Visibility = panel == "progress" ? Visibility.Visible : Visibility.Collapsed;
                pairActions.Visibility = panel == "pair" ? Visibility.Visible : Visibility.Collapsed;
                if (panel == "pair")
                {
                    primaryButton.Content = primary;
                    secondaryButton.Content = secondary;
                    secondaryButton.Visibility = secondary == null ? Visibility.Collapsed : Visibility.Visible;
                }
                onPrimary = onP;
                onSecondary = onS;
                content.BeginAnimation(UIElement.OpacityProperty, To(1, 240));
                move.BeginAnimation(TranslateTransform.YProperty, To(0, 320, EaseOut, 0, 8));
            };
            content.BeginAnimation(UIElement.OpacityProperty, fadeOut);
            if (bubbleSay != null && bubbleSay != bubbleText.Text) Say(bubbleSay);
        }

        // ------------------------------------------------------------------ setup

        void Welcome()
        {
            var existing = InstallEntry.Find();
            bubbleText.Text = L.T("Hi there!", "Xin chào!");
            Steps(0);
            finePrint.Text = L.T("Just for you · no admin rights needed", "Cài cho riêng bạn · không cần quyền quản trị");
            if (existing != null)
            {
                installButton.Content = L.T("Update", "Cập nhật");
                Show(null, L.T("Welcome back!", "Chào bạn quay lại!"), existing.Version != null && existing.Version != version
                    ? L.T("Moshi " + existing.Version + " is already here. Update to " + version + " and your accounts and moments stay put.", "Moshi " + existing.Version + " đã có trên máy. Cập nhật lên " + version + " nhé, tài khoản và khoảnh khắc vẫn còn nguyên.")
                    : L.T("Moshi is already installed. Reinstall to repair or refresh it; your data stays put.", "Moshi đã có trên máy. Cài lại để sửa lỗi hoặc làm mới, dữ liệu của bạn vẫn còn nguyên."), "welcome", null, null, () => Begin(), null);
            }
            else
            {
                Show(null, L.T("Hi, we're Moshi!", "Chào bạn, mình là Moshi!"), L.T("The Buddies bring Messenger, Instagram, Telegram, Zalo and WhatsApp under one roof, so you never miss anyone.", "Bộ đôi sẽ gom Messenger, Instagram, Telegram, Zalo và WhatsApp về chung một nhà, để bạn không bỏ lỡ ai."), "welcome", null, null, () => Begin(), null);
            }
        }

        static Process[] RunningApp() =>
            Process.GetProcessesByName("Moshi").Concat(Process.GetProcessesByName("Unison")).Where(p => p.Id != Process.GetCurrentProcess().Id).ToArray();

        /// <summary>The app used to be called Unison: its program files go, its data folder stays (Moshi moves it over on first start).</summary>
        static void RemoveLegacy(InstallEntry legacy)
        {
            try
            {
                string core = legacy.Get("UnisonCoreUninstall") ?? legacy.Get("QuietUninstallString") ?? legacy.Get("UninstallString");
                string dir = legacy.Location;
                if (core != null)
                {
                    string exe = core.StartsWith("\"") ? core.Substring(1, core.IndexOf('"', 1) - 1) : core.Split(' ')[0];
                    if (string.IsNullOrEmpty(dir)) dir = System.IO.Path.GetDirectoryName(exe);
                    if (File.Exists(exe) && !exe.EndsWith("Unison Uninstall.exe", StringComparison.OrdinalIgnoreCase))
                    {
                        var p = Process.Start(new ProcessStartInfo(exe, "/S _?=" + dir) { UseShellExecute = false, CreateNoWindow = true });
                        p.WaitForExit();
                    }
                }
                bool isAppDir = dir != null && System.IO.Path.GetFileName(dir.TrimEnd('\\')).Equals("Unison", StringComparison.OrdinalIgnoreCase)
                    && dir.IndexOf(@"\Programs\", StringComparison.OrdinalIgnoreCase) >= 0;
                if (isAppDir && Directory.Exists(dir)) Directory.Delete(dir, true);
                using (var uninstall = Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Uninstall", true))
                    uninstall?.DeleteSubKeyTree(legacy.KeyPath.Substring(legacy.KeyPath.LastIndexOf('\\') + 1), false);
            }
            catch { }
        }

        /// <summary>Moshi has to be closed before its files can be replaced.</summary>
        bool AskToCloseApp(Action then)
        {
            if (RunningApp().Length == 0) return false;
            Show(L.T("Oops, one sec!", "Ơ, khoan đã!"), L.T("Moshi is open", "Moshi đang mở"), L.T("We need to close Moshi for a moment. Your messages are safe.", "Mình cần đóng Moshi một chút để cài. Tin nhắn của bạn vẫn an toàn."), "pair", L.T("Close Moshi and continue", "Đóng Moshi và tiếp tục"), L.T("Later", "Để sau"), () =>
            {
                foreach (var p in RunningApp())
                {
                    try
                    {
                        p.CloseMainWindow();
                        if (!p.WaitForExit(2500)) p.Kill();
                    }
                    catch { }
                }
                then();
            }, () => Window.Close());
            return true;
        }

        void Begin()
        {
            if (AskToCloseApp(Begin)) return;
            _ = Install();
        }

        static readonly string[] Tips =
        {
            L.T("Tip: Ctrl K opens the command palette, so you can find anything fast.", "Mẹo: Ctrl K mở bảng lệnh, tìm gì cũng nhanh."),
            L.T("Tip: hover a message and tap the sparkle to keep it as a moment.", "Mẹo: rê chuột vào tin nhắn rồi bấm lấp lánh để lưu khoảnh khắc."),
            L.T("Tip: tag people to filter your chats in one click.", "Mẹo: gắn tag cho từng người để lọc cuộc trò chuyện trong một chạm."),
            L.T("Tip: GIFs and our own stickers are right next to the message box.", "Mẹo: nút GIF và bộ sticker riêng nằm ngay cạnh ô soạn tin."),
            L.T("Tip: Ctrl + and Ctrl − zoom the interface on 4K screens.", "Mẹo: Ctrl + và Ctrl − để phóng to giao diện trên màn 4K.")
        };

        async Task Install()
        {
            busy = true;
            closeButton.IsEnabled = false;
            Steps(1);
            Working();
            Show(L.T("Just a moment...", "Chờ xíu nhé..."), L.T("The Buddies are moving Moshi in", "Bộ đôi đang dọn nhà cho Moshi"), Tips[0], "progress");
            progressText.Text = L.T("Getting ready", "Đang chuẩn bị");
            SetProgress(0.02);

            string temp = System.IO.Path.Combine(System.IO.Path.GetTempPath(), "moshi-setup-" + Guid.NewGuid().ToString("N").Substring(0, 8));
            Directory.CreateDirectory(temp);
            string payload = System.IO.Path.Combine(temp, "moshi-core.exe");
            int exit = -1;
            string error = null;
            try
            {
                await Task.Run(() => Res.Save("payload.exe", payload));
                var legacy = InstallEntry.FindLegacy();
                if (legacy != null) await Task.Run(() => RemoveLegacy(legacy));
                var existing = InstallEntry.Find();
                // For the update itself, point the Windows entry straight at the NSIS uninstaller: the package looks
                // it up to remove the old version, and going through this program would open the goodbye window.
                // Register() points it back at "Moshi Uninstall.exe" once the new version is in.
                string coreUninstall = existing?.Get("MoshiCoreUninstall");
                if (existing != null && !string.IsNullOrEmpty(coreUninstall)) existing.Set("UninstallString", coreUninstall);
                string dir = existing?.Location ?? defaultDir;
                long baseline = await Task.Run(() => FolderSize(dir));
                bool fresh = baseline < expectedBytes / 3;
                var started = DateTime.Now;
                int tip = 0;
                var ticker = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(220) };
                ticker.Tick += async (s, e) =>
                {
                    double seconds = (DateTime.Now - started).TotalSeconds;
                    // Fresh installs: how much of the app is on disk. Updates overwrite files, so use time.
                    double byTime = 1 - Math.Exp(-seconds / 7.0);
                    double bySize = expectedBytes > 0 && fresh ? (await Task.Run(() => FolderSize(dir))) / (double)expectedBytes : 0;
                    SetProgress(Math.Min(0.96, Math.Max(0.04, Math.Max(byTime * 0.9, bySize * 0.96))));
                    progressText.Text = seconds < 1.2 ? L.T("Unpacking", "Đang mở hộp") : L.T("Putting things in place", "Đang sắp xếp đồ đạc");
                    int t = (int)(seconds / 3.2) % Tips.Length;
                    if (t != tip)
                    {
                        tip = t;
                        subtitle.Text = Tips[t];
                    }
                };
                ticker.Start();
                exit = await Task.Run(() =>
                {
                    var p = Process.Start(new ProcessStartInfo(payload, "/S") { UseShellExecute = false, CreateNoWindow = true });
                    p.WaitForExit();
                    return p.ExitCode;
                });
                ticker.Stop();
                if (exit == 0) installedDir = await Task.Run(() => Register());
            }
            catch (Exception ex)
            {
                error = ex.Message;
            }
            finally
            {
                try { Directory.Delete(temp, true); } catch { }
            }
            busy = false;
            closeButton.IsEnabled = true;
            if (exit == 0 && installedDir != null) Done();
            else Failed(error ?? L.T("Error code ", "Mã lỗi ") + exit);
        }

        /// <summary>After NSIS: put our uninstaller next to the app and point "Apps & features" at it.</summary>
        string Register()
        {
            var entry = InstallEntry.Find();
            string dir = entry?.Location ?? defaultDir;
            if (!File.Exists(System.IO.Path.Combine(dir, "Moshi.exe"))) return null;
            if (entry != null && Res.Has("uninstaller.exe"))
            {
                string goodbye = System.IO.Path.Combine(dir, "Moshi Uninstall.exe");
                Res.Save("uninstaller.exe", goodbye);
                // electron-builder leaves InstallLocation empty for per-user installs; the uninstaller needs it.
                if (string.IsNullOrEmpty(entry.Location)) entry.Set("InstallLocation", dir);
                string current = entry.Get("UninstallString");
                if (current != null && !current.Contains("Moshi Uninstall.exe")) entry.Set("MoshiCoreUninstall", current);
                entry.Set("UninstallString", "\"" + goodbye + "\" --uninstall");
            }
            return dir;
        }

        void SetProgress(double value)
        {
            double width = 380 * Math.Max(0, Math.Min(1, value));
            progressFill.BeginAnimation(FrameworkElement.WidthProperty, To(width, 260, EaseOut));
            percent.Text = Math.Round(value * 100) + "%";
        }

        static long FolderSize(string dir)
        {
            try
            {
                if (!Directory.Exists(dir)) return 0;
                return new DirectoryInfo(dir).EnumerateFiles("*", SearchOption.AllDirectories).Sum(f =>
                {
                    try { return f.Length; } catch { return 0L; }
                });
            }
            catch { return 0; }
        }

        void Done()
        {
            SetProgress(1);
            Steps(2);
            Hop(orangeHost, 0, 2);
            Hop(pink, 200, 2);
            Celebrate();
            Show(L.T("All done!", "Xong rồi!"), L.T("The whole gang is ready", "Cả nhà đã sẵn sàng"), L.T("Open Moshi, connect your first account, and every conversation lands in one place.", "Mở Moshi, kết nối tài khoản đầu tiên và mọi cuộc trò chuyện sẽ về chung một chỗ."), "pair", L.T("Open Moshi", "Mở Moshi"), L.T("Later", "Để sau"), () =>
            {
                try
                {
                    Process.Start(new ProcessStartInfo(System.IO.Path.Combine(installedDir, "Moshi.exe")) { UseShellExecute = true, WorkingDirectory = installedDir });
                }
                catch { }
                Window.Close();
            }, () => Window.Close());
            var idle = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(1900) };
            idle.Tick += (s, e) =>
            {
                idle.Stop();
                Idle();
            };
            idle.Start();
        }

        void Failed(string detail)
        {
            Idle();
            Show(L.T("Uh-oh...", "Ơ..."), L.T("Something went wrong", "Có gì đó chưa ổn"), L.T("Setup didn't finish (" + detail + "). Try again, and if it keeps failing, restart your PC and run the installer again.", "Cài đặt chưa xong (" + detail + "). Thử lại nhé, nếu vẫn lỗi hãy khởi động lại máy rồi chạy lại bộ cài."), "pair", L.T("Try again", "Thử lại"), L.T("Close", "Đóng"), () => Begin(), () => Window.Close());
        }

        /// <summary>Confetti in the characters' colours, falling with a little drift and spin.</summary>
        void Celebrate()
        {
            var colors = new[] { "#FF5B1F", "#FFC21A", "#13B26B", "#FF6FB5", "#1F6BFF", "#9B5DE5" };
            confetti.Children.Clear();
            for (int i = 0; i < 70; i++)
            {
                var brush = new SolidColorBrush((Color)ColorConverter.ConvertFromString(colors[i % colors.Length]));
                Shape piece;
                switch (i % 3)
                {
                    case 0: piece = new Ellipse { Width = 7, Height = 7 }; break;
                    case 1: piece = new Rectangle { Width = 10, Height = 4, RadiusX = 2, RadiusY = 2 }; break;
                    default: piece = new Polygon { Points = new PointCollection { new Point(0, 8), new Point(4.5, 0), new Point(9, 8) } }; break;
                }
                piece.Fill = brush;
                piece.RenderTransformOrigin = new Point(0.5, 0.5);
                var spin = new RotateTransform(rng.Next(0, 360));
                piece.RenderTransform = spin;
                double x = rng.NextDouble() * 620;
                Canvas.SetLeft(piece, x);
                Canvas.SetTop(piece, -20);
                confetti.Children.Add(piece);
                double delay = rng.NextDouble() * 500;
                double fall = 1800 + rng.NextDouble() * 1500;
                var drop = new DoubleAnimation(-20 - rng.NextDouble() * 120, 520, TimeSpan.FromMilliseconds(fall)) { BeginTime = TimeSpan.FromMilliseconds(delay), EasingFunction = new QuadraticEase { EasingMode = EasingMode.EaseIn } };
                piece.BeginAnimation(Canvas.TopProperty, drop);
                piece.BeginAnimation(Canvas.LeftProperty, new DoubleAnimation(x, x + (rng.NextDouble() - 0.5) * 140, TimeSpan.FromMilliseconds(fall)) { BeginTime = TimeSpan.FromMilliseconds(delay), EasingFunction = EaseInOut });
                spin.BeginAnimation(RotateTransform.AngleProperty, new DoubleAnimation(spin.Angle, spin.Angle + (rng.Next(0, 2) == 0 ? -1 : 1) * (360 + rng.Next(0, 360)), TimeSpan.FromMilliseconds(fall)) { BeginTime = TimeSpan.FromMilliseconds(delay) });
            }
        }

        // ------------------------------------------------------------------ uninstall

        void Goodbye()
        {
            bubbleText.Text = L.T("Bye for now...", "Tạm biệt nhé...");
            Steps(0);
            var entry = InstallEntry.Find();
            if (entry == null)
            {
                Show(null, L.T("Moshi isn't installed", "Không thấy Moshi trên máy"), L.T("It looks like Moshi has already been removed.", "Có vẻ Moshi đã được gỡ rồi."), "pair", L.T("Close", "Đóng"), null, () => Window.Close());
                return;
            }
            Show(null, L.T("Leaving Moshi already?", "Bạn định chia tay Moshi thật sao?"), L.T("The Buddies will miss you. Your accounts, settings and moments are kept, so you can pick up right where you left off.", "Bộ đôi sẽ nhớ bạn lắm. Tài khoản, cài đặt và khoảnh khắc vẫn được giữ lại, lần sau cài là dùng tiếp ngay."), "pair", L.T("Keep Moshi", "Giữ lại Moshi"), L.T("Uninstall", "Gỡ cài đặt"), () => Window.Close(), () => BeginUninstall());
        }

        void BeginUninstall()
        {
            if (AskToCloseApp(BeginUninstall)) return;
            _ = Uninstall();
        }

        async Task Uninstall()
        {
            var entry = InstallEntry.Find();
            string core = entry?.Get("MoshiCoreUninstall") ?? entry?.Get("QuietUninstallString");
            string dir = entry?.Location;
            if (string.IsNullOrEmpty(dir) && core != null)
            {
                string exe = core.StartsWith("\"") ? core.Substring(1, core.IndexOf('"', 1) - 1) : core.Split(' ')[0];
                dir = System.IO.Path.GetDirectoryName(exe);
            }
            if (string.IsNullOrEmpty(dir)) dir = defaultDir;
            busy = true;
            closeButton.IsEnabled = false;
            Steps(1);
            Working();
            Show(L.T("Tidying up...", "Đang thu dọn..."), L.T("Uninstalling Moshi", "Đang gỡ Moshi"), L.T("Just a few seconds.", "Chỉ vài giây thôi."), "progress");
            progressText.Text = L.T("Tidying up", "Đang thu dọn");
            SetProgress(0.05);
            string error = null;
            try
            {
                var started = DateTime.Now;
                var ticker = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(200) };
                ticker.Tick += (s, e) => SetProgress(Math.Min(0.95, 1 - Math.Exp(-(DateTime.Now - started).TotalSeconds / 2.5)));
                ticker.Start();
                await Task.Run(() =>
                {
                    if (core != null)
                    {
                        // "C:\...\Uninstall Moshi.exe" /currentuser  ->  run in place (_?=) so we can wait for it.
                        string exe = core.StartsWith("\"") ? core.Substring(1, core.IndexOf('"', 1) - 1) : core.Split(' ')[0];
                        string rest = core.Substring(core.StartsWith("\"") ? core.IndexOf('"', 1) + 1 : exe.Length).Trim();
                        rest = rest.Replace("/S", "").Trim();
                        if (File.Exists(exe))
                        {
                            var p = Process.Start(new ProcessStartInfo(exe, (rest + " /S _?=" + dir).Trim()) { UseShellExecute = false, CreateNoWindow = true });
                            p.WaitForExit();
                        }
                    }
                    // Whatever is left (the NSIS uninstaller itself, our copy) goes too.
                    // Safety: only ever remove the app folder itself (...\Programs\Moshi), never anything wider.
                    bool isAppDir = dir != null && System.IO.Path.GetFileName(dir.TrimEnd('\\')).Equals("Moshi", StringComparison.OrdinalIgnoreCase)
                        && dir.IndexOf("Programs", StringComparison.OrdinalIgnoreCase) >= 0;
                    for (int i = 0; i < 6 && isAppDir && Directory.Exists(dir); i++)
                    {
                        try { Directory.Delete(dir, true); } catch { System.Threading.Thread.Sleep(400); }
                    }
                    var still = InstallEntry.Find();
                    if (still != null) Registry.CurrentUser.DeleteSubKeyTree(still.KeyPath, false);
                });
                ticker.Stop();
            }
            catch (Exception ex)
            {
                error = ex.Message;
            }
            busy = false;
            closeButton.IsEnabled = true;
            SetProgress(1);
            Steps(2);
            Idle();
            if (error != null) Show(L.T("Uh-oh...", "Ơ..."), L.T("Uninstall didn't finish", "Gỡ chưa xong"), L.T("Something went wrong (" + error + "). Please try again.", "Có lỗi khi gỡ (" + error + "). Bạn thử lại nhé."), "pair", L.T("Try again", "Thử lại"), L.T("Close", "Đóng"), () => BeginUninstall(), () => Window.Close());
            else Show(L.T("See you soon!", "Hẹn gặp lại!"), L.T("Moshi is uninstalled", "Đã gỡ Moshi"), L.T("Thanks for using Moshi. Whenever you miss us, just install it again. Everything will be waiting.", "Cảm ơn bạn đã dùng Moshi. Khi nào nhớ tụi mình thì cài lại nhé, mọi thứ vẫn chờ bạn."), "pair", L.T("Close", "Đóng"), null, () => Window.Close());
            Window.Closed += (s, e) => ScheduleSelfDelete();
        }

        static void ScheduleSelfDelete()
        {
            string self = Assembly.GetExecutingAssembly().Location;
            // Only the temporary copy made in Main (never the installed program).
            if (!System.IO.Path.GetFileName(self).StartsWith("moshi-goodbye-", StringComparison.OrdinalIgnoreCase)) return;
            try
            {
                Process.Start(new ProcessStartInfo("cmd.exe", "/c ping 127.0.0.1 -n 3 > nul & del /q \"" + self + "\"") { CreateNoWindow = true, UseShellExecute = false, WindowStyle = ProcessWindowStyle.Hidden });
            }
            catch { }
        }
    }
}
