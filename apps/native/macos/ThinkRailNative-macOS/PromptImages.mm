#import <AppKit/AppKit.h>
#import <ImageIO/ImageIO.h>
#import <UniformTypeIdentifiers/UniformTypeIdentifiers.h>
#import <React/RCTBridgeModule.h>

static const NSUInteger ImageBudget = 4718592;

static NSDictionary *prepareImageData(NSData *data, NSString *name)
{
  if (!data) return nil;
  CGImageSourceRef source = CGImageSourceCreateWithData((__bridge CFDataRef)data, NULL);
  if (!source) return nil;
  NSDictionary *properties = CFBridgingRelease(CGImageSourceCopyPropertiesAtIndex(source, 0, NULL));
  NSUInteger width = [properties[(__bridge NSString *)kCGImagePropertyPixelWidth] unsignedIntegerValue];
  NSUInteger height = [properties[(__bridge NSString *)kCGImagePropertyPixelHeight] unsignedIntegerValue];
  NSUInteger orientation = [properties[(__bridge NSString *)kCGImagePropertyOrientation] unsignedIntegerValue];
  if (orientation >= 5 && orientation <= 8) {NSUInteger swap = width; width = height; height = swap;}
  NSString *type = (__bridge NSString *)CGImageSourceGetType(source);
  NSString *mime = @{@"public.png": @"image/png", @"public.jpeg": @"image/jpeg", @"com.compuserve.gif": @"image/gif", @"org.webmproject.webp": @"image/webp"}[type];
  NSString *encoded = nil;
  if (mime && MAX(width, height) <= 1568 && ((data.length + 2) / 3) * 4 <= ImageBudget) {
    encoded = [data base64EncodedStringWithOptions:0];
  } else {
    NSDictionary *options = @{(__bridge NSString *)kCGImageSourceCreateThumbnailFromImageAlways: @YES,
                             (__bridge NSString *)kCGImageSourceCreateThumbnailWithTransform: @YES,
                             (__bridge NSString *)kCGImageSourceThumbnailMaxPixelSize: @1568};
    CGImageRef image = CGImageSourceCreateThumbnailAtIndex(source, 0, (__bridge CFDictionaryRef)options);
    if (image) {
      width = CGImageGetWidth(image);
      height = CGImageGetHeight(image);
      NSBitmapImageRep *bitmap = [[NSBitmapImageRep alloc] initWithCGImage:image];
      CGImageRelease(image);
      mime = [mime isEqualToString:@"image/jpeg"] ? @"image/jpeg" : @"image/png";
      data = [bitmap representationUsingType:[mime isEqualToString:@"image/jpeg"] ? NSBitmapImageFileTypeJPEG : NSBitmapImageFileTypePNG properties:@{}];
      for (NSNumber *quality in @[@0.9, @0.8, @0.7, @0.6, @0.5]) {
        if (((data.length + 2) / 3) * 4 <= ImageBudget) break;
        mime = @"image/jpeg";
        data = [bitmap representationUsingType:NSBitmapImageFileTypeJPEG properties:@{NSImageCompressionFactor: quality}];
      }
      if (data && ((data.length + 2) / 3) * 4 <= ImageBudget) encoded = [data base64EncodedStringWithOptions:0];
    }
  }
  CFRelease(source);
  if (!encoded.length || !width || !height) return nil;
  return @{@"id": NSUUID.UUID.UUIDString, @"name": name, @"width": @(width), @"height": @(height),
           @"content": @{@"type": @"image", @"data": encoded, @"mimeType": mime}};
}

static NSDictionary *prepareImage(NSURL *url)
{
  return prepareImageData([NSData dataWithContentsOfURL:url], url.lastPathComponent);
}

static NSDictionary *prepareSources(NSArray<NSDictionary *> *sources)
{
  NSMutableArray *images = [NSMutableArray array];
  NSMutableArray *errors = [NSMutableArray array];
  for (NSDictionary *source in sources) {
    @autoreleasepool {
      NSString *uri = source[@"uri"];
      NSString *name = source[@"name"];
      NSDictionary *image = nil;
      if ([uri hasPrefix:@"data:image/"]) {
        NSRange comma = [uri rangeOfString:@","];
        if (comma.location != NSNotFound && [[uri substringToIndex:comma.location] hasSuffix:@";base64"]) {
          NSData *data = [[NSData alloc] initWithBase64EncodedString:[uri substringFromIndex:comma.location + 1] options:0];
          image = prepareImageData(data, name);
        }
      } else {
        NSURL *url = [uri hasPrefix:@"/"] ? [NSURL fileURLWithPath:uri] : [NSURL URLWithString:uri];
        if (url.isFileURL && (!url.host.length || [url.host isEqualToString:@"localhost"])) {
          BOOL scoped = [url startAccessingSecurityScopedResource];
          image = prepareImage(url);
          if (scoped) [url stopAccessingSecurityScopedResource];
        }
      }
      if (image) [images addObject:image];
      else [errors addObject:@{@"id": NSUUID.UUID.UUIDString, @"name": name, @"reason": @"unsupported image format or image too large"}];
    }
  }
  return @{@"images": images, @"errors": errors};
}

@interface PromptImages : NSObject <RCTBridgeModule>
@property(nonatomic, strong) NSOpenPanel *panel;
@end

@implementation PromptImages
RCT_EXPORT_MODULE();
+ (BOOL)requiresMainQueueSetup { return NO; }

RCT_REMAP_METHOD(pick, pickWithResolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
{
  dispatch_async(dispatch_get_main_queue(), ^{
    if (self.panel) { reject(@"picker_busy", @"An image picker is already open.", nil); return; }
    self.panel = [NSOpenPanel openPanel];
    self.panel.allowedContentTypes = @[UTTypeImage];
    self.panel.allowsMultipleSelection = YES;
    self.panel.canChooseDirectories = NO;
    self.panel.prompt = @"Attach";
    [self.panel beginWithCompletionHandler:^(NSModalResponse response) {
      NSArray<NSURL *> *urls = response == NSModalResponseOK ? self.panel.URLs : @[];
      self.panel = nil;
      dispatch_async(dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0), ^{
        NSMutableArray *sources = [NSMutableArray array];
        for (NSURL *url in urls) {
          [sources addObject:@{@"uri": url.absoluteString, @"name": url.lastPathComponent}];
        }
        resolve(prepareSources(sources));
      });
    }];
  });
}

RCT_REMAP_METHOD(prepare, prepareSources:(NSArray<NSDictionary *> *)sources resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
{
  dispatch_async(dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0), ^{
    resolve(prepareSources(sources));
  });
}
@end
