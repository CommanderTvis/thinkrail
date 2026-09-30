#import <Cocoa/Cocoa.h>

int main(int argc, const char *argv[]) {
  NSLog(@"THINKRAIL_NATIVE_MAIN %.0f", [NSDate date].timeIntervalSince1970 * 1000);
  return NSApplicationMain(argc, argv);
}
