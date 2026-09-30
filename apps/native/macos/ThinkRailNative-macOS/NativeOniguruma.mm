#import <Foundation/Foundation.h>
#import <React/RCTBridgeModule.h>
#import <ThinkRailOniguruma/oniguruma.h>
#include <vector>

@interface NativeScanner : NSObject
@property(nonatomic, strong) NSMutableArray<NSValue *> *regexes;
@end
@implementation NativeScanner
- (instancetype)init {if ((self = [super init])) _regexes = [NSMutableArray array]; return self;}
- (void)dealloc {for (NSValue *value in _regexes) onig_free((OnigRegex)value.pointerValue);}
@end

static NSDictionary *compileScanner(NativeScanner *scanner, NSArray<NSString *> *patterns)
{
  static dispatch_once_t once;
  dispatch_once(&once, ^{OnigEncoding encoding = ONIG_ENCODING_UTF8; onig_initialize(&encoding, 1);});
  for (NSString *pattern in patterns) {
    NSData *bytes = [pattern dataUsingEncoding:NSUTF8StringEncoding];
    const OnigUChar empty[2] = {0, 0};
    const OnigUChar *data = bytes.length ? (const OnigUChar *)bytes.bytes : empty;
    OnigRegex regex;
    OnigErrorInfo errorInfo;
    int status = onig_new(&regex, data, data + bytes.length,
                          ONIG_OPTION_CAPTURE_GROUP, ONIG_ENCODING_UTF8, ONIG_SYNTAX_DEFAULT, &errorInfo);
    if (status != ONIG_NORMAL) {
      OnigUChar message[ONIG_MAX_ERROR_MESSAGE_LEN];
      onig_error_code_to_str(message, status, &errorInfo);
      return @{@"error": [NSString stringWithUTF8String:(const char *)message]};
    }
    [scanner.regexes addObject:[NSValue valueWithPointer:regex]];
  }
  return nil;
}

static NSDictionary *scanPatterns(NativeScanner *scanner, NSString *text, NSUInteger start, NSUInteger options)
{
  if (!scanner || start > text.length) return nil;
  NSData *bytes = [text dataUsingEncoding:NSUTF8StringEncoding];
  const OnigUChar empty[2] = {0, 0};
  const OnigUChar *data = bytes.length ? (const OnigUChar *)bytes.bytes : empty;
  std::vector<NSUInteger> toUTF16(bytes.length + 1), toUTF8(text.length + 1);
  for (NSUInteger offset = 0, position = 0; offset < bytes.length;) {
    NSUInteger count = data[offset] < 0x80 ? 1 : data[offset] < 0xE0 ? 2 : data[offset] < 0xF0 ? 3 : 4;
    for (NSUInteger byte = 0; byte < count; byte++) toUTF16[offset + byte] = position;
    toUTF8[position] = offset;
    if (count == 4) toUTF8[position + 1] = offset;
    position += count == 4 ? 2 : 1;
    offset += count;
    toUTF16[offset] = position;
    toUTF8[position] = offset;
  }
  OnigOptionType flags = ONIG_OPTION_NONE;
  if (options & 1) flags |= ONIG_OPTION_NOT_BEGIN_STRING;
  if (options & 2) flags |= ONIG_OPTION_NOT_END_STRING;
  if (options & 4) flags |= ONIG_OPTION_NOT_BEGIN_POSITION;
  OnigRegion *region = onig_region_new();
  NSDictionary *best = nil;
  int bestStart = INT_MAX;
  for (NSUInteger index = 0; index < scanner.regexes.count; index++) {
    int status = onig_search((OnigRegex)scanner.regexes[index].pointerValue, data, data + bytes.length,
                             data + toUTF8[start], data + bytes.length, region, flags);
    if (status < 0 || status >= bestStart) continue;
    bestStart = status;
    NSMutableArray *captures = [NSMutableArray array];
    for (int group = 0; group < region->num_regs; group++) {
      BOOL missing = region->beg[group] < 0;
      NSUInteger begin = missing ? UINT_MAX : toUTF16[region->beg[group]];
      NSUInteger end = missing ? UINT_MAX : toUTF16[region->end[group]];
      [captures addObject:@{@"start": @(begin), @"end": @(end), @"length": @(missing ? 0 : end - begin)}];
    }
    best = @{@"index": @(index), @"captureIndices": captures};
    if ((NSUInteger)status == toUTF8[start]) break;
  }
  onig_region_free(region, 1);
  return best;
}

@interface NativeOniguruma : NSObject <RCTBridgeModule>
@property(nonatomic, strong) NSMutableDictionary<NSNumber *, NativeScanner *> *scanners;
@property(nonatomic) NSUInteger nextId;
@end
@implementation NativeOniguruma
RCT_EXPORT_MODULE();
+ (BOOL)requiresMainQueueSetup {return NO;}
- (instancetype)init {if ((self = [super init])) _scanners = [NSMutableDictionary dictionary]; return self;}
- (NSDictionary *)constantsToExport {return @{@"probe": @([NSProcessInfo.processInfo.environment[@"THINKRAIL_NATIVE_SYNTAX_PROBE"] isEqualToString:@"1"])};}
RCT_EXPORT_BLOCKING_SYNCHRONOUS_METHOD(createScanner:(NSArray<NSString *> *)patterns)
{
  NativeScanner *scanner = [NativeScanner new];
  NSDictionary *error = compileScanner(scanner, patterns);
  if (error) return error;
  NSNumber *identifier = @(++_nextId);
  _scanners[identifier] = scanner;
  return @{@"id": identifier};
}
RCT_EXPORT_BLOCKING_SYNCHRONOUS_METHOD(scan:(NSNumber *)identifier text:(NSString *)text start:(NSNumber *)start options:(NSNumber *)options)
{
  return scanPatterns(_scanners[identifier], text, start.unsignedIntegerValue, options.unsignedIntegerValue);
}
RCT_EXPORT_BLOCKING_SYNCHRONOUS_METHOD(disposeScanner:(NSNumber *)identifier)
{
  [_scanners removeObjectForKey:identifier];
  return @YES;
}
RCT_EXPORT_METHOD(reportProbe:(NSDictionary *)report)
{
  if (![NSProcessInfo.processInfo.environment[@"THINKRAIL_NATIVE_SYNTAX_PROBE"] isEqualToString:@"1"]) return;
  NSData *json = [NSJSONSerialization dataWithJSONObject:report options:0 error:nil];
  NSLog(@"THINKRAIL_SYNTAX_PROBE %@", [[NSString alloc] initWithData:json encoding:NSUTF8StringEncoding]);
}
- (void)invalidate {[_scanners removeAllObjects];}
@end
