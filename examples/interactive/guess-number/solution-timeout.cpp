#include <chrono>
#include <iostream>
#include <thread>

int main() {
    int n;
    if (!(std::cin >> n)) {
        return 0;
    }

    std::cout << (n / 2);
    std::this_thread::sleep_for(std::chrono::seconds(10));
    return 0;
}
