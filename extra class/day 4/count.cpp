#include<iostream>
using namespace std;
int main(){
    int a;
    cout<<"enter a number = ";
    cin>>a;
     int k=0;
     while (a > 0)
     {
        k++;
        a=a/10;
     }
     cout<<" total number ="<<k;
     

    return 0;
}