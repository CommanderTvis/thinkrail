#include <CoreGraphics/CoreGraphics.h>
#include <stdio.h>
#include <stdlib.h>
#include <time.h>
#include <unistd.h>

static double epoch_ms(void) {
  struct timespec time;
  clock_gettime(CLOCK_REALTIME, &time);
  return (double)time.tv_sec * 1000.0 + (double)time.tv_nsec / 1000000.0;
}

static int has_window(pid_t pid) {
  CFArrayRef windows = CGWindowListCopyWindowInfo(kCGWindowListOptionAll, kCGNullWindowID);
  if (!windows) return 0;
  int found = 0;
  for (CFIndex i = 0; i < CFArrayGetCount(windows); i++) {
    CFDictionaryRef window = CFArrayGetValueAtIndex(windows, i);
    CFNumberRef owner = CFDictionaryGetValue(window, kCGWindowOwnerPID);
    CFNumberRef layer = CFDictionaryGetValue(window, kCGWindowLayer);
    CFDictionaryRef bounds = CFDictionaryGetValue(window, kCGWindowBounds);
    int owner_pid = 0;
    int layer_number = -1;
    CGRect rect = CGRectZero;
    if (!owner || !layer || !bounds) continue;
    CFNumberGetValue(owner, kCFNumberIntType, &owner_pid);
    CFNumberGetValue(layer, kCFNumberIntType, &layer_number);
    if (!CGRectMakeWithDictionaryRepresentation(bounds, &rect)) continue;
    if (owner_pid == pid && layer_number == 0 && rect.size.width >= 300 && rect.size.height >= 200) {
      found = 1;
      break;
    }
  }
  CFRelease(windows);
  return found;
}

int main(int argc, char **argv) {
  if (argc != 2) return 2;
  pid_t pid = (pid_t)atoi(argv[1]);
  if (pid <= 0) return 2;
  double deadline = epoch_ms() + 60000;
  while (epoch_ms() < deadline) {
    if (has_window(pid)) {
      printf("%.0f\n", epoch_ms());
      return 0;
    }
    usleep(10000);
  }
  return 1;
}
