#import "AppDelegate.h"

#import <React/RCTBundleURLProvider.h>
#import <React/RCTRootView.h>
#import <ReactAppDependencyProvider/RCTAppDependencyProvider.h>

@implementation AppDelegate

- (void)applicationDidFinishLaunching:(NSNotification *)notification
{
  self.moduleName = @"ThinkRailNative";
  self.dependencyProvider = [RCTAppDependencyProvider new];
  __block BOOL reportedFirstContent = NO;
  [[NSNotificationCenter defaultCenter] addObserverForName:RCTContentDidAppearNotification
                                                    object:nil
                                                     queue:nil
                                                usingBlock:^(NSNotification *contentNotification) {
    if (reportedFirstContent) return;
    reportedFirstContent = YES;
    NSLog(@"THINKRAIL_FIRST_CONTENT %.0f", [NSDate date].timeIntervalSince1970 * 1000);
  }];
  BOOL hostless = [[NSProcessInfo processInfo].environment[@"THINKRAIL_PROTOTYPE_HOSTLESS"] isEqualToString:@"1"];
  NSString *hostURL = hostless ? @"" : [NSProcessInfo processInfo].environment[@"THINKRAIL_NATIVE_HOST_URL"];
  if (!hostless && ![hostURL hasPrefix:@"http://127.0.0.1:"]) hostURL = @"http://127.0.0.1:43423";
  NSString *workspaceId = [NSProcessInfo processInfo].environment[@"THINKRAIL_NATIVE_WORKSPACE_ID"];
  NSString *benchmarkPort = [NSProcessInfo processInfo].environment[@"THINKRAIL_NATIVE_BENCHMARK_PORT"];
  NSMutableDictionary *props = [@{ @"hostURL": hostURL } mutableCopy];
  if (workspaceId) props[@"workspaceId"] = workspaceId;
  if (benchmarkPort) props[@"benchmarkPort"] = benchmarkPort;
  NSString *automationURL = [NSProcessInfo processInfo].environment[@"THINKRAIL_NATIVE_AUTOMATION_URL"];
  if (automationURL) {
    props[@"automationURL"] = automationURL;
    [NSApp setActivationPolicy:NSApplicationActivationPolicyProhibited];
  }
  self.initialProps = props;
  [super applicationDidFinishLaunching:notification];
  self.window.styleMask |= NSWindowStyleMaskFullSizeContentView;
  self.window.title = @"ThinkRail";
  self.window.titleVisibility = NSWindowTitleHidden;
  self.window.titlebarAppearsTransparent = YES;
  self.window.backgroundColor = [NSColor colorWithRed:24.0/255 green:24.0/255 blue:27.0/255 alpha:1];
  self.window.minSize = NSMakeSize(900, 600);
  if (self.window.frame.size.width < 900 || self.window.frame.size.height < 600) {
    [self.window setFrame:self.window.screen.visibleFrame display:YES];
  }
  if (automationURL) [self.window orderOut:nil];
}

- (NSURL *)sourceURLForBridge:(RCTBridge *)bridge
{
  return [self bundleURL];
}

- (NSURL *)bundleURL
{
#if DEBUG
  return [[RCTBundleURLProvider sharedSettings] jsBundleURLForBundleRoot:@"index"];
#else
  return [[NSBundle mainBundle] URLForResource:@"main" withExtension:@"jsbundle"];
#endif
}

- (BOOL)concurrentRootEnabled
{
#ifdef RN_FABRIC_ENABLED
  return true;
#else
  return false;
#endif
}

@end
