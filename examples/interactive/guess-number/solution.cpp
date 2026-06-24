#include <iostream>

int main() {
    int n;
    if (!(std::cin >> n)) {
        return 0;
    }

    int left = 1;
    int right = n;
    while (left <= right) {
        int mid = (left + right) / 2;
        std::cout << mid << std::endl;

        int response;
        if (!(std::cin >> response)) {
            return 0;
        }

        if (response == 0) {
            return 0;
        }
        if (response > 0) {
            left = mid + 1;
        } else {
            right = mid - 1;
        }
    }

    return 0;
}
