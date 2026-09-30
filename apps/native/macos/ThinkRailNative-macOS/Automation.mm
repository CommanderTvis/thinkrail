#import <AppKit/AppKit.h>
#import <React/RCTBridgeModule.h>

@interface ThinkRailAutomation : NSObject <RCTBridgeModule>
@end

@implementation ThinkRailAutomation

RCT_EXPORT_MODULE()

+ (BOOL)requiresMainQueueSetup
{
  return NO;
}

- (dispatch_queue_t)methodQueue
{
  return dispatch_get_main_queue();
}

static NSTextView *FocusedTextView(void)
{
  for (NSWindow *window in NSApp.windows) {
    NSResponder *responder = window.firstResponder;
    if ([responder isKindOfClass:NSTextView.class]) return (NSTextView *)responder;
    if ([responder isKindOfClass:NSTextField.class]) {
      NSText *editor = [(NSTextField *)responder currentEditor];
      if ([editor isKindOfClass:NSTextView.class]) return (NSTextView *)editor;
    }
  }
  return nil;
}

RCT_EXPORT_METHOD(focusedSelection:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject)
{
  NSTextView *view = FocusedTextView();
  if (!view) {
    resolve([NSNull null]);
    return;
  }
  NSRange range = view.selectedRange;
  resolve(@{@"start": @(range.location), @"end": @(NSMaxRange(range)), @"text": view.string ?: @""});
}

RCT_EXPORT_METHOD(insertText:(NSString *)text replaceAll:(BOOL)replaceAll resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject)
{
  if (NSProcessInfo.processInfo.environment[@"THINKRAIL_NATIVE_AUTOMATION_URL"] == nil) {
    reject(@"automation_disabled", @"Automation is not enabled for this process", nil);
    return;
  }
  NSTextView *view = FocusedTextView();
  if (!view) {
    reject(@"no_text_input", @"No focused text input", nil);
    return;
  }
  if (replaceAll) [view selectAll:nil];
  if (text.length) [view insertText:text replacementRange:NSMakeRange(NSNotFound, 0)];
  else if (replaceAll) [view deleteBackward:nil];
  resolve(nil);
}

@end
