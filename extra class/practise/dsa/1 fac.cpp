#include<iostream>
using namespace std;

bool inprime(int n) {
    if (n < 2)
        return false;
    for (int i = 2; i <= n / 2; ++i) {
        if (n % i == 0)
            return false;
    }
    return true;
}

int main(){
    int number;
    cout << "Enter a non-negative integer: ";
    cin >> number;  
    if(inprime(number)){
        cout << number << " is a prime number." << endl;
    } else {
        cout << number << " is not a prime number." << endl;
    }   
    for (int i = 1; i <= number; i++) {
        if (number%i == 0 && inprime(i)) {
            cout << i << " ";
        }
    }
    return 0;
    

}