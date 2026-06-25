#include <iostream>

int main() {
    int x;
    if (!(std::cin >> x)) {
        return 0;
    }

    std::cout << x * 2 << std::endl;
    return 0;
}
