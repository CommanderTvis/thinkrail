#import <AppKit/AppKit.h>
#import <React/RCTComponent.h>
#import <React/RCTConvert.h>
#import <React/RCTViewManager.h>

@interface ThinkRailSecureTextField : NSSecureTextField <NSTextFieldDelegate>
@property (nonatomic, copy) RCTDirectEventBlock onTextChange;
@property (nonatomic, copy) RCTDirectEventBlock onSubmit;
@property (nonatomic, assign) BOOL autoFocus;
@end

@implementation ThinkRailSecureTextField

- (instancetype)initWithFrame:(NSRect)frame
{
  if ((self = [super initWithFrame:frame])) {
    self.delegate = self;
    self.bordered = NO;
    self.drawsBackground = NO;
    self.focusRingType = NSFocusRingTypeNone;
    self.usesSingleLineMode = YES;
    self.cell.scrollable = YES;
  }
  return self;
}

- (void)setValue:(NSString *)value
{
  if (![self.stringValue isEqualToString:value ?: @""]) self.stringValue = value ?: @"";
}

- (void)setPlaceholder:(NSString *)placeholder
{
  self.placeholderString = placeholder;
}

- (void)setFontSize:(CGFloat)fontSize
{
  self.font = [NSFont systemFontOfSize:fontSize];
}

- (void)viewDidMoveToWindow
{
  [super viewDidMoveToWindow];
  if (self.autoFocus && self.window) {
    dispatch_async(dispatch_get_main_queue(), ^{
      [self.window makeFirstResponder:self];
    });
  }
}

- (void)controlTextDidChange:(NSNotification *)notification
{
  if (self.onTextChange) self.onTextChange(@{@"text": self.stringValue});
}

- (BOOL)control:(NSControl *)control textView:(NSTextView *)textView doCommandBySelector:(SEL)selector
{
  if (selector == @selector(insertNewline:)) {
    if (self.onSubmit) self.onSubmit(@{@"text": self.stringValue});
    return YES;
  }
  return NO;
}

@end

@interface ThinkRailSecureTextFieldManager : RCTViewManager
@end

@implementation ThinkRailSecureTextFieldManager

RCT_EXPORT_MODULE(ThinkRailSecureTextField)

- (NSView *)view
{
  return [ThinkRailSecureTextField new];
}

RCT_EXPORT_VIEW_PROPERTY(value, NSString)
RCT_EXPORT_VIEW_PROPERTY(placeholder, NSString)
RCT_EXPORT_VIEW_PROPERTY(textColor, NSColor)
RCT_EXPORT_VIEW_PROPERTY(fontSize, CGFloat)
RCT_EXPORT_VIEW_PROPERTY(autoFocus, BOOL)
RCT_EXPORT_VIEW_PROPERTY(onTextChange, RCTDirectEventBlock)
RCT_EXPORT_VIEW_PROPERTY(onSubmit, RCTDirectEventBlock)

@end
