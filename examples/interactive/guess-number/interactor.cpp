#include <fstream>
#include <iostream>

int main(int argc, char** argv) {
    if (argc < 2) {
        std::cerr << "missing input file\n";
        return 3;
    }

    std::ifstream fin(argv[1]);
    int n = 0;
    int secret = 0;
    if (!(fin >> n >> secret)) {
        std::cerr << "invalid input file\n";
        return 3;
    }

    if (n <= 0 || secret < 1 || secret > n) {
        std::cerr << "invalid n or secret\n";
        return 3;
    }

    std::cout << n << std::endl;

    const int maxQueries = 20;
    for (int query = 1; query <= maxQueries; ++query) {
        int guess = 0;
        if (!(std::cin >> guess)) {
            std::cerr << "solution stopped before finding the answer\n";
            return 1;
        }

        if (guess < 1 || guess > n) {
            std::cerr << "guess out of range: " << guess << "\n";
            return 1;
        }

        if (guess == secret) {
            std::cout << 0 << std::endl;
            return 0;
        }

        if (guess < secret) {
            std::cout << 1 << std::endl;
        } else {
            std::cout << -1 << std::endl;
        }
    }

    std::cerr << "too many queries\n";
    return 1;
}
